-- =============================================================================
-- Controle de entrega do material impresso e visão de contato do gestor
-- =============================================================================

-- ── 1. O pedido de kit ganha estado ───────────────────────────────────────
-- Sem isso a equipe de entrega tem uma lista de pedidos e nenhuma forma de
-- saber o que já saiu: na segunda semana ninguém sabe quem recebeu santinho, e
-- a escolha é entregar duas vezes ou não entregar.
alter table public.captacoes
  add column if not exists entregue_em    timestamptz,
  add column if not exists entregue_por   text,
  add column if not exists entrega_obs    text,
  -- Endereço errado, pessoa mudou, ninguém atendeu. Cancelado não é entregue,
  -- e some da lista de pendentes sem virar entrega falsa no relatório.
  add column if not exists cancelado_em   timestamptz,
  add column if not exists cancelado_por  text;

create index if not exists captacoes_entrega_pendente_idx
  on public.captacoes (criado_em)
  where itens is not null and entregue_em is null and cancelado_em is null;

/**
 * Marca um pedido como entregue, cancelado ou de volta para pendente.
 *
 * `p_estado`: 'entregue' | 'cancelado' | 'pendente'
 *
 * Só gestor. A equipe de entrega passa pelo gestor de propósito: a tabela tem
 * endereço de eleitor, e quem entrega na rua não precisa de acesso ao painel.
 */
create or replace function public.marcar_entrega(
  p_captacao_id uuid,
  p_estado      text,
  p_obs         text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_nome text;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'restrito_ao_gestor');
  end if;
  if p_estado not in ('entregue', 'cancelado', 'pendente') then
    return jsonb_build_object('ok', false, 'motivo', 'estado_invalido');
  end if;

  select primeiro_nome into v_nome from public.usuarios where id = v_uid;

  if p_estado = 'entregue' then
    update public.captacoes
       set entregue_em = now(), entregue_por = v_nome,
           cancelado_em = null, cancelado_por = null,
           entrega_obs = coalesce(nullif(btrim(p_obs), ''), entrega_obs)
     where id = p_captacao_id;
  elsif p_estado = 'cancelado' then
    update public.captacoes
       set cancelado_em = now(), cancelado_por = v_nome,
           entregue_em = null, entregue_por = null,
           entrega_obs = coalesce(nullif(btrim(p_obs), ''), entrega_obs)
     where id = p_captacao_id;
  else
    update public.captacoes
       set entregue_em = null, entregue_por = null,
           cancelado_em = null, cancelado_por = null,
           entrega_obs = coalesce(nullif(btrim(p_obs), ''), entrega_obs)
     where id = p_captacao_id;
  end if;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'pedido_nao_encontrado');
  end if;
  return jsonb_build_object('ok', true, 'estado', p_estado);
end;
$$;

revoke execute on function public.marcar_entrega(uuid, text, text) from anon, public;
grant  execute on function public.marcar_entrega(uuid, text, text) to authenticated;

-- ── 2. A fila de entrega, pronta para a tela ──────────────────────────────
-- Junta o pedido com o contato: a equipe precisa do telefone para combinar a
-- entrega, e do estado do atendimento para não bater na porta de quem pediu
-- para sair.
create or replace view public.v_entregas with (security_invoker = on) as
select
  cap.id,
  cap.nome,
  cap.telefone_e164,
  m.nome                as municipio,
  cap.endereco,
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

-- ── 3. A lista de contatos do gestor ──────────────────────────────────────
-- Uma linha por pessoa, com tudo que a tela mostra: quem atendeu, quando falou,
-- de onde veio, de qual candidato, se clicou. Sai como view porque a tela
-- filtra e ordena por quase todas essas colunas.
create or replace view public.v_contatos_gestor with (security_invoker = on) as
select
  c.id,
  c.nome,
  c.primeiro_nome,
  c.telefone_e164,
  c.origem,
  c.status,
  c.municipio_id,
  m.nome                  as municipio,
  c.atendente_id,
  u.primeiro_nome         as atendente,
  ch.rotulo               as chip,
  c.candidato_origem_id,
  cand.nome_urna          as candidato_origem,
  l.rotulo                as lista,
  c.primeiro_contato_em,
  c.resultado_em,
  c.criado_em,
  c.encaminhamento,
  c.anonimizado_em,
  c.claim_expira_em,
  c.adiado_ate,
  -- Quantas mensagens saíram de verdade (abertas no WhatsApp), e quantos
  -- candidatos já receberam material.
  (select count(*)::int from public.interacoes i
    where i.contato_id = c.id and i.aberto_wa_em is not null)      as mensagens,
  (select count(*)::int from public.contato_candidato cc
    where cc.contato_id = c.id and cc.material_enviado_em is not null) as materiais_enviados,
  (select count(*)::int from public.v_cliques_reais v
    where v.contato_id = c.id)                                      as cliques,
  exists (select 1 from public.captacoes cap
           where cap.contato_id = c.id and cap.itens is not null
             and cap.entregue_em is null and cap.cancelado_em is null) as kit_pendente
from public.contatos c
left join public.municipios m on m.id = c.municipio_id
left join public.usuarios u   on u.id = c.atendente_id
left join public.chips ch     on ch.id = c.chip_id
left join public.candidatos cand on cand.id = c.candidato_origem_id
left join public.listas l     on l.id = c.lista_id;

-- ── 4. Cada atendente, com o que está na mão dele ─────────────────────────
-- v_desempenho_atendente conta o que já terminou. Falta o que está EM ABERTO:
-- é isso que o gestor precisa para saber quem travou.
create or replace view public.v_carga_atendente with (security_invoker = on) as
select
  u.id                as atendente_id,
  u.primeiro_nome     as atendente,
  u.ativo,
  count(*) filter (where c.status = 'em_atendimento'
                     and c.claim_expira_em > now())                    as na_mao_agora,
  count(*) filter (where c.status = 'em_atendimento'
                     and c.primeiro_contato_em is not null)            as aguardando_resposta,
  count(*) filter (where c.status = 'em_atendimento'
                     and c.primeiro_contato_em is null)                as abertos_sem_falar,
  max(c.primeiro_contato_em)                                           as ultima_conversa
from public.usuarios u
left join public.contatos c on c.atendente_id = u.id
group by u.id, u.primeiro_nome, u.ativo;

-- ── 5. Personalização da página do candidato ──────────────────────────────
-- A página vai num botão do site do candidato. Cair numa página com a cara de
-- outra campanha derruba a confiança justamente no clique que importa.
alter table public.candidatos
  add column if not exists cor_fundo text
    check (cor_fundo is null or cor_fundo ~ '^#[0-9a-fA-F]{6}$'),
  add column if not exists tema text not null default 'auto'
    check (tema in ('auto', 'claro', 'escuro'));
