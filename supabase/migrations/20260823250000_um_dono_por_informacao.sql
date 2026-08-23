-- =============================================================================
-- Cada informação passa a ter UM dono
-- =============================================================================
-- O sistema nasceu com um candidato só, guardado em `config`, e com uma tabela
-- `destinos` que era a lista global de links. Quando a candidatura virou uma
-- tabela própria, essas duas coisas viraram cópias desatualizadas:
--
--   config.candidato / cargo / numero      → candidatos.nome_urna / cargo / numero
--   config.material_titulo / material_texto → materiais do candidato
--   config.kit_ativo                        → candidatos.ativo
--   destinos ('material', 'canal')          → materiais do candidato
--
-- Duas fontes para o mesmo dado não ficam iguais: a página pública mostrava o
-- candidato de `config` enquanto o atendente mandava material do candidato de
-- `candidatos`. Aqui as cópias morrem.
--
-- Sobra em `config` só o que é da OPERAÇÃO e não de ninguém em particular:
-- fuso, teto, horário, intervalo, lease, termo e responsável pelos dados.

-- ── 1. O link ganha um segundo alvo: a página do candidato ────────────────
-- Um link aponta OU para uma peça (o santinho, o vídeo) OU para a página que
-- reúne as peças daquele candidato. É esta segunda que a mensagem manda: um
-- link só, com a identificação da propaganda e o botão de sair — em vez de
-- quatro URLs cruas numa mensagem de WhatsApp.
-- v_cliques_reais muda de colunas, então não dá `create or replace`. As quatro
-- views que dependem dela só usam `contato_id` e voltam iguais no fim do
-- arquivo.
drop view if exists public.v_cliques_reais cascade;

alter table public.links
  add column if not exists candidato_id uuid references public.candidatos(id) on delete cascade;

-- Links do mundo antigo. São de teste; apagar é mais honesto que tentar
-- adivinhar para qual material cada um apontava.
delete from public.cliques where token in (
  select token from public.links where destino_id is not null
);
delete from public.links where destino_id is not null;

alter table public.links drop constraint if exists link_tem_um_alvo;
alter table public.links drop column if exists destino_id;
drop table if exists public.destinos;

alter table public.links
  add constraint link_tem_um_alvo
    check (num_nonnulls(material_id, candidato_id) = 1);

create unique index if not exists links_contato_candidato_idx
  on public.links (contato_id, candidato_id) where candidato_id is not null;

drop function if exists public.garantir_link(uuid, text);

/** O link da página de material de um candidato, para um contato. */
create or replace function public.garantir_link_candidato(p_contato_id uuid, p_candidato_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_token text;
begin
  select token into v_token from public.links
   where contato_id = p_contato_id and candidato_id = p_candidato_id;
  if v_token is not null then return v_token; end if;

  for _ in 1..5 loop
    begin
      insert into public.links (token, contato_id, candidato_id)
      values (public.gerar_token(), p_contato_id, p_candidato_id)
      returning token into v_token;
      return v_token;
    exception when unique_violation then
      select token into v_token from public.links
       where contato_id = p_contato_id and candidato_id = p_candidato_id;
      if v_token is not null then return v_token; end if;
    end;
  end loop;
  return null;
end;
$$;

revoke execute on function public.garantir_link_candidato(uuid, uuid) from anon, public, authenticated;

-- ── 2. Relatórios de clique passam a falar de peça, não de "destino" ──────
create view public.v_cliques_reais with (security_invoker = on) as
select
  l.contato_id,
  coalesce(m.candidato_id, l.candidato_id) as candidato_id,
  coalesce(m.titulo, 'Página do material')  as peca,
  coalesce(m.tipo, 'pagina')                as tipo,
  min(cl.ts)                                as primeiro_clique,
  count(*)                                  as acessos
from public.cliques cl
join public.links l on l.token = cl.token
left join public.materiais m on m.id = l.material_id
where cl.is_bot = false
group by l.contato_id, coalesce(m.candidato_id, l.candidato_id),
         coalesce(m.titulo, 'Página do material'), coalesce(m.tipo, 'pagina');

-- ── 3. Histórico do contato: mesma troca ──────────────────────────────────
create or replace function public.historico_contato(p_contato_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_contato public.contatos%rowtype;
begin
  select * into v_contato from public.contatos where id = p_contato_id;
  if v_contato.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_encontrado');
  end if;
  if v_contato.atendente_id <> v_uid and not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;

  return jsonb_build_object(
    'ok', true,
    'interacoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'etapa', i.etapa,
               'candidato', (select c.nome_urna from public.candidatos c where c.id = i.candidato_id),
               'aberto_wa_em', i.aberto_wa_em,
               'texto_enviado', i.texto_enviado,
               'resultado', i.resultado
             ) order by i.criado_em)
        from public.interacoes i
       where i.contato_id = p_contato_id and i.aberto_wa_em is not null
    ), '[]'::jsonb),
    -- Só clique de gente. O pré-carregamento do WhatsApp não conta, senão o
    -- atendente acharia que a pessoa abriu o material quando não abriu.
    'cliques', coalesce((
      select jsonb_agg(jsonb_build_object(
               'peca', coalesce(m.titulo, 'Página do material'),
               'candidato', (select ca.nome_urna from public.candidatos ca
                              where ca.id = coalesce(m.candidato_id, l.candidato_id)),
               'quando', cl.ts
             ) order by cl.ts)
        from public.cliques cl
        join public.links l on l.token = cl.token
        left join public.materiais m on m.id = l.material_id
       where l.contato_id = p_contato_id and cl.is_bot = false
    ), '[]'::jsonb),
    'pedido_kit', (
      select jsonb_build_object('endereco', cap.endereco, 'itens', cap.itens, 'em', cap.criado_em)
        from public.captacoes cap
       where cap.contato_id = p_contato_id and cap.itens is not null
       order by cap.criado_em desc limit 1
    )
  );
end;
$$;

-- ── 4. A mensagem ganha o link da página do candidato ─────────────────────
create or replace function public.preparar_mensagem(
  p_contato_id   uuid,
  p_chip_id      uuid,
  p_etapa        public.etapa_msg,
  p_candidato_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_cfg       public.config%rowtype;
  v_contato   public.contatos%rowtype;
  v_chip      public.chips%rowtype;
  v_usuario   public.usuarios%rowtype;
  v_modelo    public.modelos%rowtype;
  v_variacao  public.variacoes%rowtype;
  v_escolhida uuid;
  v_cand      public.candidatos%rowtype;
  v_materiais jsonb;
  v_pagina    text;
begin
  select * into v_cfg     from public.config where id = 1;
  select * into v_contato from public.contatos where id = p_contato_id;
  select * into v_chip    from public.chips where id = p_chip_id;
  select * into v_usuario from public.usuarios where id = v_uid;

  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;

  if public.etapa_por_candidato(p_etapa) then
    if p_candidato_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_obrigatorio');
    end if;

    -- A trava do consentimento: só alcança candidato declarado na permissão.
    if not exists (
      select 1 from public.contato_candidato cc
       where cc.contato_id = p_contato_id and cc.candidato_id = p_candidato_id
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_nao_declarado');
    end if;

    select * into v_cand from public.candidatos where id = p_candidato_id and ativo;
    if v_cand.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_inativo');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'titulo', m.titulo, 'tipo', m.tipo,
             'token', public.garantir_link_material(p_contato_id, m.id)
           ) order by m.ordem, m.titulo), '[]'::jsonb)
      into v_materiais
      from public.materiais m
     where m.candidato_id = p_candidato_id and m.ativo
       -- O convite leva só o canal; o material leva o resto.
       and (case when p_etapa = 'convite_grupo' then m.tipo = 'canal' else true end);

    -- A página que reúne as peças daquele candidato: é o {{link}} da mensagem.
    -- Um link só, com identificação de propaganda e botão de sair.
    v_pagina := public.garantir_link_candidato(p_contato_id, p_candidato_id);
  end if;

  select * into v_modelo from public.modelos where etapa = p_etapa and ativo;
  if v_modelo.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_ausente');
  end if;

  select i.variacao_id into v_escolhida
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa
     and i.candidato_id is not distinct from p_candidato_id;

  if v_escolhida is null then
    v_escolhida := public.proxima_variacao(
      v_modelo.id,
      (select r.ultima_variacao_id from public.rotacao_chip r
        where r.chip_id = p_chip_id and r.modelo_id = v_modelo.id)
    );
    if v_escolhida is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_variacao');
    end if;

    insert into public.rotacao_chip (chip_id, modelo_id, ultima_variacao_id)
    values (p_chip_id, v_modelo.id, v_escolhida)
    on conflict (chip_id, modelo_id)
      do update set ultima_variacao_id = excluded.ultima_variacao_id, atualizado_em = now();

    insert into public.interacoes
      (contato_id, atendente_id, chip_id, etapa, candidato_id, variacao_id, dia_operacional)
    values
      (p_contato_id, v_uid, p_chip_id, p_etapa, p_candidato_id, v_escolhida, public.hoje_operacional())
    on conflict (contato_id, etapa, candidato_id) do update
      set variacao_id = coalesce(interacoes.variacao_id, excluded.variacao_id)
    returning variacao_id into v_escolhida;
  end if;

  select * into v_variacao from public.variacoes where id = v_escolhida;

  return jsonb_build_object(
    'ok', true,
    'etapa', p_etapa,
    'variacao_id', v_variacao.id,
    'modelo', v_variacao.texto,
    'contato', jsonb_build_object(
      'id', v_contato.id, 'nome', v_contato.nome,
      'primeiro_nome', v_contato.primeiro_nome, 'telefone_e164', v_contato.telefone_e164
    ),
    'atendente_nome', v_usuario.primeiro_nome,
    'timezone', v_cfg.timezone,
    'municipio', (select m.nome from public.municipios m where m.id = v_contato.municipio_id),
    'chapa', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ch.candidato_id, 'nome', ch.nome_urna, 'cargo', ch.cargo,
               'numero', ch.numero, 'partido', ch.partido_sigla, 'principal', ch.principal
             ))
        from public.chapa_do_atendente(v_uid) ch
    ), '[]'::jsonb),
    'candidato', case when v_cand.id is null then null else jsonb_build_object(
      'id', v_cand.id, 'nome', v_cand.nome_urna, 'cargo', v_cand.cargo,
      'numero', v_cand.numero, 'partido', v_cand.partido_sigla,
      'cnpj', v_cand.cnpj_campanha
    ) end,
    'materiais', coalesce(v_materiais, '[]'::jsonb),
    'pagina_token', v_pagina
  );
end;
$$;

-- ── 5. As cópias saem de config ───────────────────────────────────────────
alter table public.config
  drop column if exists candidato,
  drop column if exists cargo,
  drop column if exists numero,
  drop column if exists material_titulo,
  drop column if exists material_texto,
  drop column if exists kit_ativo;

-- ── 6. As views que dependiam de v_cliques_reais, de volta ────────────────
-- Nenhuma delas usava a coluna `destino`: só `contato_id`. Voltam idênticas.

create view public.v_saude_chip with (security_invoker = on) as
with abordagens as (
  select
    i.chip_id,
    i.contato_id,
    i.aberto_wa_em,
    c.status,
    row_number() over (partition by i.chip_id order by i.aberto_wa_em desc) as recencia
  from public.interacoes i
  join public.contatos c on c.id = i.contato_id
  where i.etapa = 'permissao' and i.aberto_wa_em is not null
),
ultimas20 as (
  select * from abordagens where recencia <= 20
),
metricas as (
  select
    chip_id,
    count(*)                                                         as base,
    count(*) filter (where status = 'pediu_saida')                   as saidas,
    count(*) filter (where status = 'invalido')                      as invalidos,
    count(*) filter (where status = 'autorizou')                     as autorizou,
    count(*) filter (where aberto_wa_em < now() - interval '24 hours'
                       and status = 'em_atendimento')                as sem_resposta_24h,
    count(*) filter (where aberto_wa_em < now() - interval '24 hours') as maduros
  from ultimas20
  group by chip_id
),
cliques as (
  select u.chip_id, count(distinct u.contato_id) as com_clique
  from ultimas20 u
  join public.v_cliques_reais v on v.contato_id = u.contato_id
  where u.status = 'autorizou'
  group by u.chip_id
)
select
  ch.id                          as chip_id,
  ch.rotulo,
  ch.status,
  ch.papel,
  ch.atendente_id,
  us.primeiro_nome               as atendente,
  coalesce(m.base, 0)            as ultimas_abordagens,
  coalesce(m.saidas, 0)          as saidas,
  coalesce(m.invalidos, 0)       as invalidos,
  coalesce(m.autorizou, 0)       as autorizou,
  coalesce(cl.com_clique, 0)     as com_clique,
  round(100.0 * m.saidas    / nullif(m.base, 0), 1)             as pct_saida,
  round(100.0 * m.invalidos / nullif(m.base, 0), 1)             as pct_invalido,
  round(100.0 * m.sem_resposta_24h / nullif(m.maduros, 0), 1)   as pct_sem_resposta,
  round(100.0 * cl.com_clique / nullif(m.autorizou, 0), 1)      as pct_clique,
  -- O farol só acende com base mínima: 5 abordagens não dizem nada sobre a
  -- saúde de um número, e pausar chip por ruído é perder atendente à toa.
  case
    when coalesce(m.base, 0) < 10 then 'sem_dados'
    when 100.0 * m.saidas / nullif(m.base,0) > 30
      or 100.0 * m.invalidos / nullif(m.base,0) > 12
      or 100.0 * m.sem_resposta_24h / nullif(m.maduros,0) > 80
      or (m.autorizou >= 5 and 100.0 * coalesce(cl.com_clique,0) / m.autorizou < 30)
      then 'vermelho'
    when 100.0 * m.saidas / nullif(m.base,0) >= 15
      or 100.0 * m.invalidos / nullif(m.base,0) >= 5
      or 100.0 * m.sem_resposta_24h / nullif(m.maduros,0) >= 60
      or (m.autorizou >= 5 and 100.0 * coalesce(cl.com_clique,0) / m.autorizou < 50)
      then 'amarelo'
    else 'verde'
  end as farol
from public.chips ch
left join public.usuarios us on us.id = ch.atendente_id
left join metricas m  on m.chip_id = ch.id
left join cliques  cl on cl.chip_id = ch.id;

create view public.v_desempenho_atendente with (security_invoker = on) as
select
  u.id                                                        as atendente_id,
  u.primeiro_nome                                             as atendente,
  u.ativo,
  count(distinct i.contato_id) filter (where i.dia_operacional = public.hoje_operacional()) as hoje,
  count(distinct i.contato_id)                                as total_abordados,
  count(distinct c.id) filter (where c.status = 'autorizou')   as autorizou,
  count(distinct c.id) filter (where c.status = 'pediu_saida') as pediu_saida,
  count(distinct c.id) filter (where c.status = 'invalido')    as invalido,
  count(distinct c.id) filter (where c.status = 'quer_ajudar') as quer_ajudar,
  count(distinct c.id) filter (where c.status = 'sem_resposta') as sem_resposta,
  count(distinct vc.contato_id)                               as cliques_reais
from public.usuarios u
left join public.interacoes i  on i.atendente_id = u.id and i.etapa = 'permissao' and i.aberto_wa_em is not null
left join public.contatos c    on c.id = i.contato_id
left join public.v_cliques_reais vc on vc.contato_id = i.contato_id
where u.papel = 'atendente'
group by u.id, u.primeiro_nome, u.ativo;

create view public.v_funil_municipio with (security_invoker = on) as
select
  coalesce(m.nome, '(não informado)')                          as municipio,
  count(*)                                                     as contatos,
  count(*) filter (where c.status = 'autorizou')               as autorizou,
  count(*) filter (where c.status = 'pediu_saida')             as pediu_saida,
  count(*) filter (where c.status = 'quer_ajudar')             as quer_ajudar,
  count(distinct vc.contato_id)                                as cliques_reais
from public.contatos c
left join public.municipios m on m.id = c.municipio_id
left join public.v_cliques_reais vc on vc.contato_id = c.id
where c.primeiro_contato_em is not null
group by m.nome;

create view public.v_resumo with (security_invoker = on) as
select
  (select count(*) from public.contatos where status = 'na_fila')            as na_fila,
  (select count(*) from public.contatos where status = 'na_fila' and origem <> 'lista_fria') as fila_quente,
  (select count(*) from public.contatos where status = 'na_fila' and origem = 'lista_fria')  as fila_fria,
  (select count(*) from public.contatos where status = 'em_atendimento')     as em_atendimento,
  (select count(*) from public.contatos where primeiro_contato_em is not null) as abordados,
  (select count(*) from public.contatos where status = 'autorizou')          as autorizou,
  (select count(*) from public.contatos where status = 'pediu_saida')        as pediu_saida,
  (select count(*) from public.contatos where status = 'sem_resposta')       as sem_resposta,
  (select count(*) from public.contatos where status = 'perdido')            as perdidos,
  (select count(distinct contato_id) from public.v_cliques_reais)            as cliques_reais,
  (select count(*) from public.interacoes
    where dia_operacional = public.hoje_operacional() and aberto_wa_em is not null
      and etapa = 'permissao')                                               as abordados_hoje,
  (select count(*) from public.alertas where resolvido_em is null)           as alertas_abertos;
