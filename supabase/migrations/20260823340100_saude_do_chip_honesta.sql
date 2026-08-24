-- =============================================================================
-- O termômetro do chip parava de contar justamente o pior sinal
-- =============================================================================
-- ⚠️ Dois defeitos no farol que o gestor usa para decidir pausar um número.
--
-- 1. "SEM RESPOSTA" SUMIA DEPOIS DE 72 HORAS.
--
--    A conta era `aberto_wa_em < now() - 24h and status = 'em_atendimento'`.
--    Só que a automação `fechar_sem_resposta` troca esse status para
--    'sem_resposta' às 72h — e a partir daí a pessoa saía da conta.
--
--    O resultado é o pior possível para um alarme: quanto MAIS antigo o
--    silêncio, MENOR o percentual. Um chip cujas últimas 20 abordagens não
--    tiveram uma única resposta marcava vermelho por dois dias e depois voltava
--    para verde sozinho, sem nada ter melhorado. 'sem_resposta' É o desfecho
--    "não respondeu"; tirá-lo da conta de quem não respondeu não faz sentido.
--
-- 2. "CONVERSAS/HORA" NUNCA EXISTIU.
--
--    A tabela do termômetro em docs/03-OPERACAO.md §7 lista quatro sinais, e o
--    quarto é ritmo: < 20/h verde, 20–30 amarelo, > 30 vermelho. A view nunca
--    calculou isso, então o gestor lia uma tabela que prometia um sinal que a
--    tela não dava.
--
--    Ritmo entra ANTES da amostra mínima de propósito: os outros três sinais
--    são estatística e precisam de base, mas 40 conversas numa hora é medida
--    direta — e é justamente num chip novo, ainda sem histórico, que ela mais
--    importa.

create or replace view public.v_saude_chip with (security_invoker = on) as
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
    -- 'sem_resposta' entra junto: é o mesmo silêncio, só que já fechado pelo
    -- cron das 72h.
    count(*) filter (where aberto_wa_em < now() - interval '24 hours'
                       and status in ('em_atendimento', 'sem_resposta'))  as sem_resposta_24h,
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
),
-- Ritmo da última hora, sobre TODAS as etapas: o antispam do WhatsApp olha
-- quantas conversas o número abriu, não em que etapa do roteiro elas estavam.
ritmo as (
  select i.chip_id, count(distinct i.contato_id) as conversas_hora
  from public.interacoes i
  where i.aberto_wa_em > now() - interval '1 hour'
  group by i.chip_id
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
  case
    -- Ritmo é medida direta: vale mesmo em chip sem histórico, que é onde ela
    -- mais importa.
    when coalesce(rt.conversas_hora, 0) > 30 then 'vermelho'
    -- Os outros três sinais são estatística. 5 abordagens não dizem nada sobre
    -- a saúde de um número, e pausar chip por ruído é perder atendente à toa.
    when coalesce(m.base, 0) < 10 then
      case when coalesce(rt.conversas_hora, 0) >= 20 then 'amarelo' else 'sem_dados' end
    when 100.0 * m.saidas / nullif(m.base,0) > 30
      or 100.0 * m.invalidos / nullif(m.base,0) > 12
      or 100.0 * m.sem_resposta_24h / nullif(m.maduros,0) > 80
      or (m.autorizou >= 5 and 100.0 * coalesce(cl.com_clique,0) / m.autorizou < 30)
      then 'vermelho'
    when coalesce(rt.conversas_hora, 0) >= 20
      or 100.0 * m.saidas / nullif(m.base,0) >= 15
      or 100.0 * m.invalidos / nullif(m.base,0) >= 5
      or 100.0 * m.sem_resposta_24h / nullif(m.maduros,0) >= 60
      or (m.autorizou >= 5 and 100.0 * coalesce(cl.com_clique,0) / m.autorizou < 50)
      then 'amarelo'
    else 'verde'
  end as farol,
  -- Coluna nova vai no FIM: `create or replace view` não aceita inserir no meio.
  coalesce(rt.conversas_hora, 0)::int as conversas_hora
from public.chips ch
left join public.usuarios us on us.id = ch.atendente_id
left join metricas m  on m.chip_id = ch.id
left join cliques  cl on cl.chip_id = ch.id
left join ritmo    rt on rt.chip_id = ch.id;
