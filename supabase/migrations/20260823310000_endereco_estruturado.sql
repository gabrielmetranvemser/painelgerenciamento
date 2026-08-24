-- =============================================================================
-- Endereço de entrega em partes, com CEP
-- =============================================================================
-- `captacoes.endereco` era um textarea. Quem entrega o material na rua lia
-- "Rua das Flores 123 fundos perto do mercado" e "R. das Flores casa azul" como
-- dois endereços — e nenhum dos dois tinha bairro para montar rota.
--
-- Agora as partes têm coluna. `endereco` CONTINUA existindo e continua sendo
-- escrito, com a linha montada a partir das partes: é o que o relatório, a
-- exportação e a busca da tela de entregas já leem, e é o que mantém os pedidos
-- antigos — feitos quando o campo era livre — na mesma lista dos novos.
--
-- Não há coluna de complemento de propósito. Vinha vazia em quase todo pedido e
-- quem precisava escrevia "fundos" no número.

alter table public.captacoes
  -- 8 dígitos, sem hífen. Nunca obrigatório: em Rondônia há cidade com um CEP
  -- só para o município inteiro, e há quem simplesmente não saiba o seu.
  add column if not exists cep              text,
  add column if not exists rua              text,
  add column if not exists numero           text,
  add column if not exists bairro           text,
  -- Estava no meio do texto livre ("... e o tamanho da camiseta"), então
  -- chegava como "M/G", "media" e "veste 40". Lista fechada resolve.
  add column if not exists tamanho_camiseta text;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'captacoes_cep_formato') then
    alter table public.captacoes
      add constraint captacoes_cep_formato
      check (cep is null or cep ~ '^[0-9]{8}$');
  end if;

  if not exists (select 1 from pg_constraint where conname = 'captacoes_tamanho_camiseta') then
    alter table public.captacoes
      add constraint captacoes_tamanho_camiseta
      check (tamanho_camiseta is null or tamanho_camiseta in ('P', 'M', 'G', 'GG', 'XGG'));
  end if;
end $$;

-- Rota de entrega é por bairro. Sem índice, a tela do gestor varre a tabela
-- inteira para agrupar.
create index if not exists captacoes_bairro_idx
  on public.captacoes (municipio_id, bairro)
  where itens is not null and entregue_em is null and cancelado_em is null;

-- ── A view de entregas mostra as partes ──────────────────────────────────
-- `create or replace view` só aceita colunas NOVAS no fim da lista: renomear ou
-- inserir no meio devolve "cannot change name of view column". Como as partes
-- do endereço têm de ficar junto do endereço para a planilha sair legível, a
-- view é derrubada e refeita.
--
-- Sem `cascade`, de propósito: se algum dia outra view passar a depender desta,
-- o push falha aqui e alguém decide o que fazer — em vez de derrubar junto o
-- que ninguém sabia que existia.
drop view if exists public.v_entregas;

create view public.v_entregas with (security_invoker = on) as
select
  cap.id,
  cap.nome,
  cap.telefone_e164,
  m.nome                as municipio,
  cap.endereco,
  cap.cep,
  cap.rua,
  cap.numero,
  cap.bairro,
  cap.tamanho_camiseta,
  cap.itens,
  cap.criado_em         as pedido_em,
  cap.entregue_em,
  cap.entregue_por,
  cap.cancelado_em,
  cap.cancelado_por,
  cap.entrega_obs,
  cand.nome_urna        as candidato,
  cap.contato_id,
  ct.status             as status_contato,
  u.primeiro_nome       as atendente,
  case
    when cap.entregue_em  is not null then 'entregue'
    when cap.cancelado_em is not null then 'cancelado'
    else 'pendente'
  end                   as estado
from public.captacoes cap
left join public.municipios m  on m.id = cap.municipio_id
left join public.candidatos cand on cand.id = cap.candidato_id
left join public.contatos ct   on ct.id = cap.contato_id
left join public.usuarios u    on u.id = ct.atendente_id
where cap.itens is not null;

-- ── O pedido de kit registrado pelo atendente ────────────────────────────
-- A assinatura antiga sai de cena. Manter as duas faria a chamada por nome de
-- argumento ficar ambígua, e o PostgREST recusaria as duas.
drop function if exists public.registrar_pedido_kit(uuid, text, text[], smallint);

create or replace function public.registrar_pedido_kit(
  p_contato_id   uuid,
  p_itens        text[],
  p_endereco     text     default null,   -- a linha montada, para os relatórios
  p_cep          text     default null,
  p_rua          text     default null,
  p_numero       text     default null,
  p_bairro       text     default null,
  p_tamanho      text     default null,
  p_municipio_id smallint default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_contato public.contatos%rowtype;
  v_id      uuid;
  v_cep     text := nullif(regexp_replace(coalesce(p_cep, ''), '[^0-9]', '', 'g'), '');
begin
  select * into v_contato from public.contatos where id = p_contato_id;
  if v_contato.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if v_contato.atendente_id <> v_uid and not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  if v_contato.anonimizado_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'dados_apagados');
  end if;
  if p_itens is null or cardinality(p_itens) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_itens');
  end if;

  -- CEP com qualquer coisa que não sejam 8 dígitos entra como nulo em vez de
  -- estourar a restrição: o pedido vale, o que falta é um campo opcional.
  if v_cep is not null and v_cep !~ '^[0-9]{8}$' then
    v_cep := null;
  end if;

  if p_municipio_id is not null then
    update public.contatos set municipio_id = p_municipio_id where id = p_contato_id;
  end if;

  select cap.id into v_id
    from public.captacoes cap
   where cap.contato_id = p_contato_id and cap.itens is not null
   order by cap.criado_em desc limit 1;

  if v_id is null then
    insert into public.captacoes
      (origem, nome, telefone_e164, chave_dedup, municipio_id, endereco,
       cep, rua, numero, bairro, tamanho_camiseta, itens, virou_contato, contato_id)
    values
      ('kit', v_contato.nome, v_contato.telefone_e164, v_contato.chave_dedup,
       coalesce(p_municipio_id, v_contato.municipio_id), p_endereco,
       v_cep, p_rua, p_numero, p_bairro, p_tamanho, p_itens, true, p_contato_id);
  else
    update public.captacoes
       set endereco         = p_endereco,
           cep              = v_cep,
           rua              = p_rua,
           numero           = p_numero,
           bairro           = p_bairro,
           tamanho_camiseta = p_tamanho,
           itens            = p_itens,
           municipio_id     = coalesce(p_municipio_id, municipio_id),
           nome             = v_contato.nome,
           telefone_e164    = v_contato.telefone_e164
     where id = v_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── O histórico devolve o endereço em partes ─────────────────────────────
-- Substitui a versão de 20260823250000. Só o bloco `pedido_kit` muda: a tela do
-- atendente precisa das partes para reabrir o formulário já preenchido.
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
      select jsonb_build_object(
               'endereco', cap.endereco,
               'cep', cap.cep,
               'rua', cap.rua,
               'numero', cap.numero,
               'bairro', cap.bairro,
               'tamanho_camiseta', cap.tamanho_camiseta,
               'itens', cap.itens,
               'em', cap.criado_em)
        from public.captacoes cap
       where cap.contato_id = p_contato_id and cap.itens is not null
       order by cap.criado_em desc limit 1
    )
  );
end;
$$;

revoke execute on function public.registrar_pedido_kit(uuid, text[], text, text, text, text, text, text, smallint) from anon, public;
grant  execute on function public.registrar_pedido_kit(uuid, text[], text, text, text, text, text, text, smallint) to authenticated;
