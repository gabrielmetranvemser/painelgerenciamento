-- =============================================================================
-- "Meus contatos" com recorte, e o Encaminhar chegando ao gestor
-- =============================================================================
-- Duas telas que existiam pela metade.
--
-- 1. MEUS CONTATOS trazia 300 linhas em ordem de data, sem recorte nenhum. O
--    atendente que abre essa tela quase sempre quer UMA coisa — "quem está
--    esperando resposta", "quem pedi para falar depois" — e estava garimpando.
--    Com onze desfechos em vez de cinco, garimpar deixa de ser viável.
--
-- 2. ENCAMINHAR gravava o pedido da pessoa em `contatos.encaminhamento`... e
--    esse texto só chegava ao gestor pelo CSV. Não havia recorte, nem coluna na
--    tela, nem contador. Na prática ninguém encaminhava nada: o atendente
--    escrevia "perguntou sobre vaga de emprego", a pessoa ouvia "vou levar sua
--    pergunta pra equipe", e a pergunta morria no banco. É a promessa que o
--    sistema mais quebrava.

-- ── O encaminhamento precisa poder ser DADO POR RESOLVIDO ───────────────────
-- Sem isto a lista do gestor só cresce, e uma lista que só cresce é uma lista
-- que ninguém abre depois da segunda semana.
alter table public.contatos
  add column if not exists encaminhamento_tratado_em  timestamptz,
  add column if not exists encaminhamento_tratado_por uuid references public.usuarios(id);

comment on column public.contatos.encaminhamento_tratado_em is
  'Quando o gestor deu o encaminhamento por resolvido. Nulo = ainda na fila dele.';

create index if not exists contatos_encaminhamento_aberto_idx
  on public.contatos (resultado_em desc)
  where encaminhamento is not null and encaminhamento_tratado_em is null;

create or replace function public.marcar_encaminhamento_tratado(
  p_contato_id uuid,
  p_tratado    boolean default true
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'so_gestor');
  end if;

  update public.contatos
     set encaminhamento_tratado_em  = case when p_tratado then now() end,
         encaminhamento_tratado_por = case when p_tratado then v_uid end
   where id = p_contato_id
     and encaminhamento is not null;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'sem_encaminhamento');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.marcar_encaminhamento_tratado(uuid, boolean) from anon, public;
grant  execute on function public.marcar_encaminhamento_tratado(uuid, boolean) to authenticated;

-- ── A tela do gestor ganha o recorte "Encaminhados" ─────────────────────────
-- ⚠️ A chave nova entra AQUI e em `recortes.ts` ao mesmo tempo. O cabeçalho
-- daquele arquivo avisa: aba acrescentada de um lado só cai calada em "todos",
-- e o gestor vê a lista inteira achando que está vendo o recorte.
create or replace function public.contatos_do_gestor(
  p_recorte    text    default 'todos',
  p_atendente  uuid    default null,
  p_candidato  uuid    default null,
  p_municipio  smallint default null,
  p_origem     text    default null,
  p_lista      uuid    default null,
  p_sem_lista  boolean default false,
  p_busca      text    default null,
  p_pagina     int     default 0,
  p_por_pagina int     default 100
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_busca    text;
  v_digitos  text;
  v_resposta jsonb;
begin
  if not public.is_gestor() then
    return jsonb_build_object('erro', 'somente_gestor');
  end if;

  p_por_pagina := least(greatest(coalesce(p_por_pagina, 100), 1), 200);
  p_pagina     := greatest(coalesce(p_pagina, 0), 0);

  v_busca   := nullif(btrim(coalesce(p_busca, '')), '');
  v_digitos := nullif(regexp_replace(coalesce(v_busca, ''), '\D', '', 'g'), '');
  if length(coalesce(v_digitos, '')) < 4 then v_digitos := null; end if;

  with base as (
    select c.id, c.criado_em, c.status, c.primeiro_contato_em,
           (c.encaminhamento is not null and c.encaminhamento_tratado_em is null)
             as encaminhamento_aberto,
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
  recortada as (
    select * from base b
     where case p_recorte
             when 'pendentes'    then b.status = 'em_atendimento' and b.primeiro_contato_em is not null
             when 'na_fila'      then b.status = 'na_fila'
             when 'autorizou'    then b.status = 'autorizou'
             when 'pediu_saida'  then b.status = 'pediu_saida'
             when 'kit'          then b.kit_pendente
             when 'encaminhados' then b.encaminhamento_aberto
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
        'todos',        count(*),
        'pendentes',    count(*) filter (where b.status = 'em_atendimento' and b.primeiro_contato_em is not null),
        'na_fila',      count(*) filter (where b.status = 'na_fila'),
        'autorizou',    count(*) filter (where b.status = 'autorizou'),
        'pediu_saida',  count(*) filter (where b.status = 'pediu_saida'),
        'kit',          count(*) filter (where b.kit_pendente),
        'encaminhados', count(*) filter (where b.encaminhamento_aberto)
      ) from base b
    ),
    'total', (select count(*) from recortada),
    'linhas', coalesce((
      select jsonb_agg(to_jsonb(v) order by v.criado_em desc)
        from public.v_contatos_gestor v
        join pagina p on p.id = v.id
    ), '[]'::jsonb)
  ) into v_resposta;

  return v_resposta;
end;
$$;

-- ── E "Meus contatos" ganha recorte, contagem e paginação ───────────────────
/**
 * Os contatos que este atendente já abordou, recortados por desfecho.
 *
 * As contagens saem do conjunto INTEIRO (respeitando a busca), e não da página:
 * é o mesmo desenho de `contatos_do_gestor`, e pelo mesmo motivo — as abas
 * dizem quantos existem em cada situação, a lista mostra a aba aberta.
 *
 * ⚠️ Contar e paginar no BANCO, não no navegador. A versão anterior pedia 300
 * linhas e não filtrava nada; com o teto de 30 conversas por dia, um atendente
 * passa de 300 em duas semanas e os mais antigos sumiriam da tela em silêncio —
 * exatamente o defeito que a tela de contatos do gestor já teve.
 */
create or replace function public.meus_contatos(
  p_status     text default 'todos',
  p_busca      text default null,
  p_pagina     int  default 0,
  p_por_pagina int  default 50
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_busca   text;
  v_digitos text;
  v_r       jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('erro', 'sem_sessao');
  end if;

  p_por_pagina := least(greatest(coalesce(p_por_pagina, 50), 1), 200);
  p_pagina     := greatest(coalesce(p_pagina, 0), 0);

  v_busca   := nullif(btrim(coalesce(p_busca, '')), '');
  v_digitos := nullif(regexp_replace(coalesce(v_busca, ''), '\D', '', 'g'), '');
  if length(coalesce(v_digitos, '')) < 4 then v_digitos := null; end if;

  with base as (
    select c.id, c.nome, c.primeiro_nome, c.telefone_e164, c.origem, c.status,
           c.primeiro_contato_em, c.resultado_em, c.adiado_ate, c.anonimizado_em,
           c.encaminhamento,
           (select m.nome from public.municipios m where m.id = c.municipio_id) as municipio
      from public.contatos c
     -- Só as próprias linhas. `security definer` passa por cima do RLS, então
     -- este filtro é a permissão inteira desta função.
     where c.atendente_id = v_uid
       and c.primeiro_contato_em is not null
       and (
         v_busca is null
         or c.nome ilike '%' || v_busca || '%'
         or (v_digitos is not null and c.telefone_e164 like '%' || v_digitos || '%')
       )
  ),
  recortada as (
    select * from base b
     where p_status = 'todos' or b.status::text = p_status
  ),
  pagina as (
    select r.* from recortada r
     order by coalesce(r.resultado_em, r.primeiro_contato_em) desc
     limit p_por_pagina offset p_pagina * p_por_pagina
  )
  select jsonb_build_object(
    -- Contagem POR STATUS, num objeto — a tela monta as abas a partir dele, em
    -- vez de ter a lista de desfechos escrita de novo aqui. Assim um desfecho
    -- novo aparece sozinho, sem migration.
    'contagens', coalesce((
      select jsonb_object_agg(t.status, t.n)
        from (select b.status::text as status, count(*) as n from base b group by 1) t
    ), '{}'::jsonb),
    'todos', (select count(*) from base),
    'total', (select count(*) from recortada),
    'linhas', coalesce((
      select jsonb_agg(to_jsonb(p) order by coalesce(p.resultado_em, p.primeiro_contato_em) desc)
        from pagina p
    ), '[]'::jsonb)
  ) into v_r;

  return v_r;
end;
$$;

revoke execute on function public.meus_contatos(text, text, int, int) from anon, public;
grant  execute on function public.meus_contatos(text, text, int, int) to authenticated;
