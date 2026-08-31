-- =============================================================================
-- Grupos de lista: ligar e desligar um bloco inteiro, sem apagar nada
-- =============================================================================
-- Pedido de quem opera, com a comparação dele: "semelhante campanhas do Meta".
-- Depois da reimportação de 31/08 a tela de Listas ficou com quase quarenta
-- linhas — as novas e as antigas misturadas — e desligar as antigas exigia
-- clicar em Pausar uma por uma.
--
-- ⚠️ A DECISÃO QUE IMPORTA: o grupo ESCREVE em `listas.ativa`, em vez de a fila
--    passar a consultar o grupo.
--
-- A alternativa parecia mais limpa: deixar `ativa` como está e fazer toda
-- consulta perguntar "a lista está ativa E o grupo dela também?". Só que
-- `l.ativa` é lido em sete lugares — `fila_status` (duas vezes),
-- `pegar_proximo_contato`, `pegar_contato_especifico`, `fila_do_atendente`,
-- `minhas_listas`, `listas_sem_atendente` — e alguns deles rodam por contato,
-- sobre 14 mil linhas, a cada clique de atendente. Um `join` a mais em cada um
-- é custo permanente; e a chance de esquecer UM deles é a chance de a lista
-- "desligada" continuar entregando contato para alguém, que é o defeito mais
-- caro que este sistema pode ter.
--
-- Escrevendo em `ativa`, todas as sete continuam corretas sem tocar em nenhuma.
-- A lista desligada pelo grupo está DE VERDADE desligada.
--
-- O preço é lembrar o que era de quem: sem isso, desligar e religar o grupo
-- reativaria listas que o gestor tinha pausado à mão. `pausada_pelo_grupo`
-- guarda exatamente isso — quem foi pausada PELO grupo volta com ele; quem já
-- estava pausada antes continua pausada.

create table if not exists public.grupos_lista (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null,
  ativo     boolean not null default true,
  ordem     int not null default 0,
  criado_em timestamptz not null default now(),
  constraint grupo_nome_util check (length(btrim(nome)) between 2 and 60)
);

create unique index if not exists grupos_lista_nome_uk
  on public.grupos_lista (lower(btrim(nome)));

alter table public.listas
  add column if not exists grupo_id uuid references public.grupos_lista(id) on delete set null,
  -- Só é `true` em lista que ESTAVA ativa e foi desligada pelo grupo. É o que
  -- permite religar sem ressuscitar o que o gestor tinha pausado à mão.
  add column if not exists pausada_pelo_grupo boolean not null default false;

create index if not exists listas_grupo_idx on public.listas (grupo_id);

comment on column public.listas.pausada_pelo_grupo is
  'Foi o GRUPO que pausou esta lista, não o gestor. Ver a migration grupos_de_lista.';

alter table public.grupos_lista enable row level security;

drop policy if exists grupos_lista_gestor on public.grupos_lista;
create policy grupos_lista_gestor on public.grupos_lista
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- O atendente lê para a tela dele saber a que grupo cada lista pertence.
drop policy if exists grupos_lista_leitura on public.grupos_lista;
create policy grupos_lista_leitura on public.grupos_lista
  for select to authenticated using (public.sou_ativo());

-- ── Ligar e desligar o grupo inteiro ────────────────────────────────────────
create or replace function public.alternar_grupo(p_grupo_id uuid, p_ativo boolean)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_grupo public.grupos_lista%rowtype;
  v_n     int;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'somente_gestor');
  end if;

  select * into v_grupo from public.grupos_lista where id = p_grupo_id;
  if v_grupo.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_existe');
  end if;

  if p_ativo then
    -- Volta SÓ o que este grupo desligou. Lista que o gestor pausou à mão
    -- continua pausada — ele não pediu para religar aquela.
    with voltaram as (
      update public.listas
         set ativa = true, pausada_pelo_grupo = false
       where grupo_id = p_grupo_id and pausada_pelo_grupo
      returning 1
    ) select count(*)::int into v_n from voltaram;
  else
    with pausadas as (
      update public.listas
         set ativa = false, pausada_pelo_grupo = true
       where grupo_id = p_grupo_id and ativa
      returning 1
    ) select count(*)::int into v_n from pausadas;
  end if;

  update public.grupos_lista set ativo = p_ativo where id = p_grupo_id;

  return jsonb_build_object('ok', true, 'listas_afetadas', v_n, 'nome', v_grupo.nome);
end;
$$;

-- ── Pôr (ou tirar) uma lista de um grupo ────────────────────────────────────
-- ⚠️ Entrar num grupo DESLIGADO desliga a lista junto, e sair de um religa se
-- foi ele quem a pausou. Sem isso, arrastar uma lista para um grupo desligado
-- a deixaria entregando contato dentro de um bloco que o gestor acha que está
-- fora do ar.
create or replace function public.mover_lista_para_grupo(
  p_lista_id uuid,
  p_grupo_id uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_lista public.listas%rowtype;
  v_ativo boolean;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'somente_gestor');
  end if;

  select * into v_lista from public.listas where id = p_lista_id;
  if v_lista.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'lista_nao_existe');
  end if;

  if p_grupo_id is not null then
    select ativo into v_ativo from public.grupos_lista where id = p_grupo_id;
    if v_ativo is null then
      return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_existe');
    end if;
  end if;

  -- Saindo de um grupo que a tinha pausado: ela volta.
  if v_lista.pausada_pelo_grupo and (p_grupo_id is null or coalesce(v_ativo, true)) then
    update public.listas
       set grupo_id = p_grupo_id, ativa = true, pausada_pelo_grupo = false
     where id = p_lista_id;
    return jsonb_build_object('ok', true, 'religada', true);
  end if;

  -- Entrando num grupo desligado: ela desliga junto.
  if p_grupo_id is not null and not coalesce(v_ativo, true) and v_lista.ativa then
    update public.listas
       set grupo_id = p_grupo_id, ativa = false, pausada_pelo_grupo = true
     where id = p_lista_id;
    return jsonb_build_object('ok', true, 'pausada', true);
  end if;

  update public.listas set grupo_id = p_grupo_id where id = p_lista_id;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── Apagar um grupo NÃO apaga lista nenhuma ─────────────────────────────────
-- O `on delete set null` do FK cuida do vínculo. O que esta função acrescenta é
-- devolver ao ar as listas que o grupo tinha pausado: some o grupo, some o
-- motivo de elas estarem paradas.
create or replace function public.apagar_grupo(p_grupo_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_nome text; v_n int;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'somente_gestor');
  end if;

  select nome into v_nome from public.grupos_lista where id = p_grupo_id;
  if v_nome is null then
    return jsonb_build_object('ok', false, 'motivo', 'grupo_nao_existe');
  end if;

  with voltaram as (
    update public.listas
       set ativa = true, pausada_pelo_grupo = false
     where grupo_id = p_grupo_id and pausada_pelo_grupo
    returning 1
  ) select count(*)::int into v_n from voltaram;

  delete from public.grupos_lista where id = p_grupo_id;
  return jsonb_build_object('ok', true, 'nome', v_nome, 'listas_religadas', v_n);
end;
$$;

revoke execute on function public.alternar_grupo(uuid, boolean) from anon, public;
revoke execute on function public.mover_lista_para_grupo(uuid, uuid) from anon, public;
revoke execute on function public.apagar_grupo(uuid) from anon, public;
grant execute on function public.alternar_grupo(uuid, boolean) to authenticated;
grant execute on function public.mover_lista_para_grupo(uuid, uuid) to authenticated;
grant execute on function public.apagar_grupo(uuid) to authenticated;

-- ── A view que a tela lê passa a trazer o grupo ─────────────────────────────
-- ⚠️ `total_atualizados` também entrava agora: a coluna existe desde
-- `reimportar_atualiza_sem_perder_historico` e a view nunca foi refeita, então
-- a tela de Listas não tinha como mostrar quantas pessoas vieram de outra lista
-- — que é o número que explica uma reimportação.
-- `create or replace view` não reordena nem renomeia coluna: as novas entram no
-- meio da lista, então a view cai e sobe inteira. Nada depende dela além da
-- tela de Listas.
drop view if exists public.v_listas;

create view public.v_listas with (security_invoker = on) as
select l.id,
       l.origem,
       l.rotulo,
       l.entregue_por,
       l.entregue_em,
       l.arquivo_nome,
       l.arquivo_hash,
       l.total_linhas,
       l.total_importados,
       l.total_duplicados,
       l.total_atualizados,
       l.total_bloqueados,
       l.total_invalidos,
       l.ativa,
       l.grupo_id,
       l.pausada_pelo_grupo,
       g.nome  as grupo_nome,
       g.ativo as grupo_ativo,
       g.ordem as grupo_ordem,
       l.criado_por,
       l.criado_em,
       l.concluida_em,
       coalesce(t.total, 0)   as contatos_total,
       coalesce(t.na_fila, 0) as contatos_na_fila,
       coalesce(t.falados, 0) as contatos_falados
  from public.listas l
  left join public.grupos_lista g on g.id = l.grupo_id
  left join lateral (
    select count(*) as total,
           count(*) filter (where c.status = 'na_fila') as na_fila,
           count(*) filter (where c.primeiro_contato_em is not null) as falados
      from public.contatos c
     where c.lista_id = l.id
  ) t on true;
