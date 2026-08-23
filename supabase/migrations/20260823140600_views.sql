-- =============================================================================
-- Views de relatório
-- =============================================================================
-- `security_invoker = on`: a view aplica o RLS de quem consulta. O gestor vê
-- tudo, o atendente vê só o dele — sem precisar duplicar as regras aqui.

-- ── Cliques reais ───────────────────────────────────────────────────────────
-- Uma pessoa que abre o link 5 vezes é UM clique. E o pré-carregamento do
-- WhatsApp (is_bot) não entra em nenhuma conta.
create view public.v_cliques_reais with (security_invoker = on) as
select
  l.contato_id,
  d.chave        as destino,
  min(cl.ts)     as primeiro_clique,
  count(*)       as acessos
from public.cliques cl
join public.links l    on l.token = cl.token
join public.destinos d on d.id = l.destino_id
where cl.is_bot = false
group by l.contato_id, d.chave;

-- ── Termômetro do chip (docs/03-OPERACAO.md §7) ────────────────────────────
-- Vermelho em qualquer eixo → pausar 24–48h e trocar para o reserva.
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

-- ── Desempenho por atendente ────────────────────────────────────────────────
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

-- ── Funil por município ─────────────────────────────────────────────────────
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

-- ── Resumo geral (topo do painel do gestor) ────────────────────────────────
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
