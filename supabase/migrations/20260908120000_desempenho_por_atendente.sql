-- =============================================================================
-- Desempenho por atendente: o histórico de cada um, e a comparação entre todos
-- =============================================================================
-- O pedido do gestor foi "puxar o histórico de atendimentos passados, por
-- atendente, pra mensurar desempenho". A tela de Relatórios já tinha uma tabela
-- "Por atendente" — e ela estava ERRADA. Ver a correção logo abaixo.
--
-- ⚠️ UMA definição de período, e ela recorta QUEM, não O QUÊ.
--
-- O período escolhe as pessoas: quem o atendente abordou naqueles dias. O
-- desfecho de cada uma é a situação DELA HOJE. Assim os grupos somam
-- exatamente o total de abordados, e a taxa divide o mesmo conjunto por ele
-- mesmo.
--
-- A alternativa — recortar também o desfecho, por `resultado_em` — divide
-- coisas diferentes: autorizações de conversas velhas sobre abordagens novas.
-- Em "últimos 7 dias" isso passa fácil de 100%, e um relatório que mostra 130%
-- de conversão é pior que nenhum, porque o gestor para de acreditar no resto
-- da tela junto.
--
-- ⚠️ E o desfecho sai de `contatos.status`, nunca de `interacoes.resultado`.
-- `registrar_resultado` carimba o resultado nas interações que existiam NAQUELE
-- momento; uma etapa aberta depois nasce sem carimbo. Contando pela interação,
-- a mesma pessoa aparecia como "autorizou" e como "sem desfecho" ao mesmo
-- tempo — e a soma dos grupos passava do total de gente abordada, que é o
-- número logo acima na mesma tela.

-- ── A correção: a view contava um terço do trabalho ─────────────────────────
--
-- `v_desempenho_atendente` nasceu quando a conversa tinha UM passo, e media o
-- atendente pela etapa `permissao`. Depois a conversa virou quatro passos
-- (`abertura` → `minha_escolha` → `permissao` → `material`, migration
-- `conversa_em_quatro_passos`) e quem passou a ser o primeiro contato foi a
-- `abertura`. A view ficou para trás, medindo só o terceiro passo.
--
-- O tamanho do erro, na base real no dia em que isto foi escrito:
--
--     atendente    a view dizia    tinha falado com
--     Gabriela               10                 193
--     Mariana                 2                 170
--     Thais                  17                 224
--     Roberta                82                 245
--
-- Não é imprecisão, é troca de lugar no ranking: a view punha Aline (88) na
-- frente de Roberta, que tinha falado com 28% mais gente. Um relatório que
-- ordena errado é pior que um relatório que falta, porque ele é usado.
--
-- Agora conta o que o nome diz: pessoas distintas com quem o atendente ABRIU
-- conversa, em qualquer etapa. As colunas são as mesmas — quem consome a view
-- (Visão geral, Relatórios, o CSV) não muda.
create or replace view public.v_desempenho_atendente with (security_invoker = on) as
select
  u.id                                                        as atendente_id,
  u.primeiro_nome                                             as atendente,
  u.ativo,
  count(distinct i.contato_id) filter (where i.dia_operacional = public.hoje_operacional()) as hoje,
  count(distinct i.contato_id)                                as total_abordados,
  count(distinct c.id) filter (where c.status = 'autorizou')    as autorizou,
  count(distinct c.id) filter (where c.status = 'pediu_saida')  as pediu_saida,
  count(distinct c.id) filter (where c.status = 'invalido')     as invalido,
  count(distinct c.id) filter (where c.status = 'quer_ajudar')  as quer_ajudar,
  count(distinct c.id) filter (where c.status = 'sem_resposta') as sem_resposta,
  count(distinct vc.contato_id)                               as cliques_reais
from public.usuarios u
left join public.interacoes i  on i.atendente_id = u.id and i.aberto_wa_em is not null
left join public.contatos c    on c.id = i.contato_id
left join public.v_cliques_reais vc on vc.contato_id = i.contato_id
where u.papel = 'atendente'
group by u.id, u.primeiro_nome, u.ativo;

comment on view public.v_desempenho_atendente is
  'Volume e resultado de cada atendente, desde sempre. "Abordado" é pessoa com '
  'quem ele ABRIU conversa em qualquer etapa — não só na permissão. Para o '
  'recorte por período, use relatorio_de_atendimento().';

-- ── O relatório da tela ─────────────────────────────────────────────────────
--
-- Uma função só, e não duas (uma da equipe, outra do indivíduo), porque a tela
-- mostra as duas coisas ao mesmo tempo: a comparação fica em pé enquanto o
-- gestor abre uma pessoa. Duas idas ao banco para desenhar uma tela seriam duas
-- fotos de instantes diferentes, e a soma da equipe não bateria com a linha do
-- indivíduo bem no lugar onde ele foi conferir.
--
-- `p_atendente` recorta só as séries (dia, hora, etapa, desfecho, jornada). A
-- lista `equipe` vem inteira sempre — é ela que desenha o seletor e o ranking.
create or replace function public.relatorio_de_atendimento(
  p_dias      int  default 30,
  p_atendente uuid default null
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_tz    text;
  v_hoje  date;
  v_desde date;
  v_res   jsonb;
begin
  if not public.is_gestor() then
    return jsonb_build_object('erro', 'somente_gestor');
  end if;

  select c.timezone into v_tz from public.config c where c.id = 1;
  v_hoje := public.hoje_operacional();

  -- Zero (ou nada) quer dizer "desde o começo". O começo é o primeiro dia que
  -- existe, e não uma data fixa: o rótulo da tela diz "desde 24/08", que é
  -- verdade, em vez de "desde 01/01/1970", que faria o gestor duvidar do resto.
  v_desde := case
    when coalesce(p_dias, 0) <= 0
      then coalesce((select min(i.dia_operacional) from public.interacoes i), v_hoje)
    else v_hoje - (greatest(p_dias, 1) - 1)
  end;

  with abertas as (
    -- ⚠️ `aberto_wa_em is not null` é o que separa trabalho de intenção: a
    -- interação nasce quando o painel MONTA o texto, e só ganha esta marca
    -- quando o atendente clica em "Abrir conversa". Sem o filtro, contaria
    -- como atendimento a tela que alguém abriu e fechou.
    select
      i.atendente_id,
      i.contato_id,
      i.etapa,
      c.status,
      i.dia_operacional,
      (extract(hour from (i.aberto_wa_em at time zone v_tz)))::int              as hora,
      (extract(epoch from (i.aberto_wa_em at time zone v_tz)::time) / 60)::int  as minuto
    from public.interacoes i
    join public.contatos c on c.id = i.contato_id
    where i.aberto_wa_em is not null
      and i.dia_operacional between v_desde and v_hoje
  ),

  -- O recorte do indivíduo. Nulo = a equipe toda.
  minhas as (
    select * from abertas a where p_atendente is null or a.atendente_id = p_atendente
  ),

  cliques as (
    select a.atendente_id, count(distinct a.contato_id) as cliques
      from abertas a
      join public.v_cliques_reais vc on vc.contato_id = a.contato_id
     group by a.atendente_id
  ),

  -- ⚠️ Isto é AGORA, não o período, e a tela precisa dizer isso. É o que está
  -- parado na mão da pessoa neste instante — inclusive de conversa que começou
  -- antes do recorte escolhido.
  carga as (
    select
      c.atendente_id,
      count(*) filter (where c.status = 'em_atendimento'
                         and c.claim_expira_em > now())             as na_mao_agora,
      count(*) filter (where c.status = 'em_atendimento'
                         and c.primeiro_contato_em is not null)     as aguardando_resposta,
      count(*) filter (where c.status = 'em_atendimento'
                         and c.primeiro_contato_em is null)         as abertos_sem_falar
    from public.contatos c
    where c.atendente_id is not null
    group by c.atendente_id
  ),

  equipe as (
    select
      u.id, u.primeiro_nome, u.ativo, u.foto_url,
      count(a.contato_id)                                    as aberturas,
      count(distinct a.contato_id)                           as pessoas,
      count(distinct a.dia_operacional)                      as dias_trabalhados,
      -- ⚠️ O `filter` não é redundante. Num `left join` sem nenhuma linha, o
      -- par vira `(null, null)` — que NÃO é nulo, é uma linha de dois nulos — e
      -- `count(distinct ...)` a conta como um. Sem isto, quem não trabalhou no
      -- período aparecia com "0 dias" e "1 hora" ao lado, na mesma linha.
      count(distinct (a.dia_operacional, a.hora))
        filter (where a.contato_id is not null)              as horas_ativas,
      count(distinct a.contato_id)
        filter (where a.status in ('autorizou','quer_ajudar','ja_apoia'))       as positivos,
      count(distinct a.contato_id)
        filter (where a.status = 'autorizou')                                   as autorizou,
      count(distinct a.contato_id)
        filter (where a.status in
                ('pediu_saida','invalido','nao_e_a_pessoa','mudou_de_estado'))  as negativos,
      count(distinct a.contato_id)
        filter (where a.status = 'sem_resposta')                                as sem_resposta,
      -- ⚠️ Definido pelo NEGATIVO dos outros três, de propósito: assim os
      -- quatro grupos somam o total de abordados, sempre. Listar aqui os status
      -- que sobram é combinar que um desfecho novo — e já entraram seis depois
      -- da primeira versão do sistema — suma de todas as contas ao mesmo tempo,
      -- sem sintoma nenhum além de uma soma que não fecha.
      count(distinct a.contato_id)
        filter (where a.contato_id is not null
                  and a.status not in ('autorizou','quer_ajudar','ja_apoia',
                                       'pediu_saida','invalido','nao_e_a_pessoa',
                                       'mudou_de_estado','sem_resposta'))       as em_aberto
    from public.usuarios u
    left join abertas a on a.atendente_id = u.id
    where u.papel = 'atendente'
    group by u.id, u.primeiro_nome, u.ativo, u.foto_url
  ),

  -- Dias sem nenhuma conversa entram como zero, de propósito: o buraco no
  -- gráfico É a informação. Sem o preenchimento, um sábado parado some e três
  -- dias de trabalho aparecem colados como se fossem seguidos.
  serie as (
    select
      d::date                                                    as dia,
      coalesce(count(m.contato_id), 0)                           as aberturas,
      coalesce(count(distinct m.contato_id), 0)                  as pessoas
    from generate_series(v_desde, v_hoje, interval '1 day') d
    left join minhas m on m.dia_operacional = d::date
    group by d
    order by d
  ),

  horas as (
    select
      h                                                          as hora,
      coalesce(count(m.contato_id), 0)                           as aberturas
    from generate_series(0, 23) h
    left join minhas m on m.hora = h
    group by h
    order by h
  ),

  -- Quando a pessoa começou e quando parou, por dia. NÃO é ponto eletrônico —
  -- ver o comentário da função na tela. É o intervalo em que houve conversa.
  jornada as (
    select
      m.dia_operacional                as dia,
      min(m.minuto)                    as inicio,
      max(m.minuto)                    as fim,
      count(distinct m.hora)           as horas_ativas,
      count(*)                         as aberturas,
      count(distinct m.contato_id)     as pessoas
    from minhas m
    group by m.dia_operacional
    order by m.dia_operacional
  ),

  etapas as (
    select m.etapa::text as etapa, count(*) as aberturas,
           count(distinct m.contato_id) as pessoas
      from minhas m group by m.etapa order by count(*) desc
  ),

  desfechos as (
    select m.status::text as resultado, count(distinct m.contato_id) as pessoas
      from minhas m
     group by m.status
     order by count(distinct m.contato_id) desc
  )

  select jsonb_build_object(
    'periodo', jsonb_build_object(
      'dias',  case when coalesce(p_dias, 0) <= 0 then 0 else greatest(p_dias, 1) end,
      'desde', v_desde,
      'ate',   v_hoje
    ),
    'equipe', coalesce((
      select jsonb_agg(jsonb_build_object(
        'atendente_id',        e.id,
        'atendente',           e.primeiro_nome,
        'ativo',               e.ativo,
        'foto_url',            e.foto_url,
        'aberturas',           e.aberturas,
        'pessoas',             e.pessoas,
        'dias_trabalhados',    e.dias_trabalhados,
        'horas_ativas',        e.horas_ativas,
        'positivos',           e.positivos,
        'autorizou',           e.autorizou,
        'negativos',           e.negativos,
        'sem_resposta',        e.sem_resposta,
        'em_aberto',           e.em_aberto,
        'cliques',             coalesce(cl.cliques, 0),
        'na_mao_agora',        coalesce(cg.na_mao_agora, 0),
        'aguardando_resposta', coalesce(cg.aguardando_resposta, 0),
        'abertos_sem_falar',   coalesce(cg.abertos_sem_falar, 0)
      ) order by e.pessoas desc, e.primeiro_nome)
      from equipe e
      left join cliques cl on cl.atendente_id = e.id
      left join carga   cg on cg.atendente_id = e.id
    ), '[]'::jsonb),
    'dias', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dia', s.dia, 'aberturas', s.aberturas, 'pessoas', s.pessoas
      ) order by s.dia) from serie s
    ), '[]'::jsonb),
    'horas', coalesce((
      select jsonb_agg(jsonb_build_object('hora', h.hora, 'aberturas', h.aberturas)
             order by h.hora) from horas h
    ), '[]'::jsonb),
    'jornada', coalesce((
      select jsonb_agg(jsonb_build_object(
        'dia', j.dia, 'inicio', j.inicio, 'fim', j.fim,
        'horas_ativas', j.horas_ativas, 'aberturas', j.aberturas, 'pessoas', j.pessoas
      ) order by j.dia) from jornada j
    ), '[]'::jsonb),
    'etapas', coalesce((
      select jsonb_agg(jsonb_build_object(
        'etapa', et.etapa, 'aberturas', et.aberturas, 'pessoas', et.pessoas
      ) order by et.aberturas desc) from etapas et
    ), '[]'::jsonb),
    'desfechos', coalesce((
      select jsonb_agg(jsonb_build_object('resultado', df.resultado, 'pessoas', df.pessoas)
             order by df.pessoas desc) from desfechos df
    ), '[]'::jsonb)
  ) into v_res;

  return v_res;
end;
$$;

comment on function public.relatorio_de_atendimento(int, uuid) is
  'Histórico de atendimento por atendente, para a tela de Desempenho. Coorte: '
  'tudo é sobre as conversas ABERTAS no período, e o desfecho conta no dia em '
  'que a conversa começou. p_dias = 0 significa desde o começo; p_atendente '
  'nulo recorta a equipe inteira. Só gestor.';

revoke all on function public.relatorio_de_atendimento(int, uuid) from public, anon;
grant execute on function public.relatorio_de_atendimento(int, uuid) to authenticated;
