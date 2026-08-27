-- =============================================================================
-- A tela de Contatos passa a caber a base inteira
-- =============================================================================
-- ⚠️ O PostgREST deste projeto corta toda resposta em 1.000 linhas (`max_rows`).
-- Ele não avisa: devolve 1.000 e um `count` correto, e quem escreveu
-- `.limit(5000)` acha que recebeu 5.000. A tela dizia "mostrando os 5.000 mais
-- recentes de 3.686" e mostrava 1.000 — e, pior, FILTRAVA e BUSCAVA dentro
-- desses 1.000. Procurar alguém que estava na base e receber "nada com esses
-- filtros" é o defeito mais caro que uma tela de consulta pode ter: o gestor
-- conclui que a pessoa não existe.
--
-- Levantar `max_rows` não resolveria: mandar 30 mil linhas para o navegador é
-- exatamente o travamento que se quer evitar. A saída é o servidor filtrar,
-- contar e paginar — e mandar só a página.
--
-- Uma função só, e não uma consulta por parte, porque:
--
--   • o filtro fica escrito UMA vez. Contagem que não conhece o mesmo filtro da
--     listagem é contador que mente, e esta base já tem cicatriz disso;
--   • a busca vira PARÂMETRO. Montada como texto de filtro do PostgREST
--     (`or=(nome.ilike.%x%,...)`), uma vírgula ou um parêntese digitados na
--     caixa de busca mudam a expressão inteira;
--   • uma ida ao banco em vez de sete.

-- ── A view ganha o id da lista ──────────────────────────────────────────────
-- Ela já trazia o RÓTULO, que serve para mostrar. Para FILTRAR é preciso o id:
-- filtrar por texto casaria duas listas de nomes parecidos.
--
-- A coluna entra no fim porque `create or replace view` não deixa reordenar o
-- que já existe — só acrescentar.
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
  (select count(*)::int from public.interacoes i
    where i.contato_id = c.id and i.aberto_wa_em is not null)      as mensagens,
  (select count(*)::int from public.contato_candidato cc
    where cc.contato_id = c.id and cc.material_enviado_em is not null) as materiais_enviados,
  (select count(*)::int from public.v_cliques_reais v
    where v.contato_id = c.id)                                      as cliques,
  exists (select 1 from public.captacoes cap
           where cap.contato_id = c.id and cap.itens is not null
             and cap.entregue_em is null and cap.cancelado_em is null) as kit_pendente,
  c.lista_id
from public.contatos c
left join public.municipios m on m.id = c.municipio_id
left join public.usuarios u   on u.id = c.atendente_id
left join public.chips ch     on ch.id = c.chip_id
left join public.candidatos cand on cand.id = c.candidato_origem_id
left join public.listas l     on l.id = c.lista_id;

-- ── Índices que a busca e os filtros usam ───────────────────────────────────
-- A base vai passar de 30 mil. Sem estes, cada tecla digitada na caixa de busca
-- varre a tabela inteira.
create index if not exists contatos_criado_em_idx on public.contatos (criado_em desc);
create index if not exists contatos_status_idx    on public.contatos (status);
create index if not exists contatos_origem_idx    on public.contatos (origem);
create index if not exists captacoes_contato_idx  on public.captacoes (contato_id);

-- ── A tela de Contatos, numa chamada ────────────────────────────────────────
-- Devolve as três coisas que a tela precisa e que TÊM de concordar entre si: a
-- página pedida, quantos existem em cada situação e o total do recorte atual.
create or replace function public.contatos_do_gestor(
  p_recorte    text     default 'todos',
  p_atendente  uuid     default null,
  p_candidato  uuid     default null,
  p_municipio  smallint default null,
  p_origem     text     default null,
  p_lista      uuid     default null,
  /** "Só quem não veio de lista" — captação. Diferente de "qualquer lista". */
  p_sem_lista  boolean  default false,
  p_busca      text     default null,
  p_pagina     int      default 0,
  p_por_pagina int      default 100
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_busca    text;
  v_digitos  text;
  v_resposta jsonb;
begin
  -- `security definer` passa por cima do RLS: sem esta linha, qualquer
  -- autenticado leria a base inteira com nome e telefone.
  if not public.is_gestor() then
    return jsonb_build_object('erro', 'somente_gestor');
  end if;

  -- Teto de página: o pedido vem da URL, e uma URL com `por_pagina=100000`
  -- devolveria a base inteira pela porta dos fundos.
  p_por_pagina := least(greatest(coalesce(p_por_pagina, 100), 1), 200);
  p_pagina     := greatest(coalesce(p_pagina, 0), 0);

  v_busca   := nullif(btrim(coalesce(p_busca, '')), '');
  -- Telefone se procura por dígitos: quem digita "(69) 99999" está procurando
  -- 6999999, e a coluna guarda só dígitos.
  v_digitos := nullif(regexp_replace(coalesce(v_busca, ''), '\D', '', 'g'), '');
  if length(coalesce(v_digitos, '')) < 4 then v_digitos := null; end if;

  with base as (
    select c.id, c.criado_em, c.status, c.primeiro_contato_em,
           exists (
             select 1 from public.captacoes cap
              where cap.contato_id = c.id and cap.itens is not null
                and cap.entregue_em is null and cap.cancelado_em is null
           ) as kit_pendente
      from public.contatos c
     where (p_atendente is null or c.atendente_id = p_atendente)
       and (p_candidato is null or c.candidato_origem_id = p_candidato)
       and (p_municipio is null or c.municipio_id = p_municipio)
       and (p_origem    is null or c.origem = p_origem::public.origem_contato)
       and (p_lista     is null or c.lista_id = p_lista)
       and (not p_sem_lista     or c.lista_id is null)
       and (
         v_busca is null
         or c.nome ilike '%' || v_busca || '%'
         or (v_digitos is not null and c.telefone_e164 like '%' || v_digitos || '%')
       )
  ),
  -- O recorte é aplicado DEPOIS das contagens: as abas mostram quantos existem
  -- em cada situação dentro dos filtros atuais, e a lista mostra a aba aberta.
  recortada as (
    select * from base b
     where case p_recorte
             when 'pendentes'   then b.status = 'em_atendimento' and b.primeiro_contato_em is not null
             when 'na_fila'     then b.status = 'na_fila'
             when 'autorizou'   then b.status = 'autorizou'
             when 'pediu_saida' then b.status = 'pediu_saida'
             when 'kit'         then b.kit_pendente
             else true
           end
  ),
  pagina as (
    select r.id from recortada r
     order by r.criado_em desc
     limit p_por_pagina offset p_pagina * p_por_pagina
  )
  select jsonb_build_object(
    'contagens', (
      select jsonb_build_object(
        'todos',       count(*),
        'pendentes',   count(*) filter (where b.status = 'em_atendimento' and b.primeiro_contato_em is not null),
        'na_fila',     count(*) filter (where b.status = 'na_fila'),
        'autorizou',   count(*) filter (where b.status = 'autorizou'),
        'pediu_saida', count(*) filter (where b.status = 'pediu_saida'),
        'kit',         count(*) filter (where b.kit_pendente)
      ) from base b
    ),
    'total', (select count(*) from recortada),
    -- A view pesada (contagem de mensagens, cliques, materiais) roda só para as
    -- linhas desta página, e não para as 30 mil.
    'linhas', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.criado_em desc)
        from public.v_contatos_gestor v
        join pagina p on p.id = v.id
    ), '[]'::jsonb)
  ) into v_resposta;

  return v_resposta;
end;
$$;

revoke execute on function public.contatos_do_gestor(text, uuid, uuid, smallint, text, uuid, boolean, text, int, int) from anon, public;
grant  execute on function public.contatos_do_gestor(text, uuid, uuid, smallint, text, uuid, boolean, text, int, int) to authenticated;
