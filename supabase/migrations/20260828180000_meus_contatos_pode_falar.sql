-- =============================================================================
-- "Falar depois": quem decide se a hora chegou é o SERVIDOR
-- =============================================================================
-- A lista de "Meus contatos" mostra, em quem foi marcado como "Falar depois",
-- se o reagendamento já venceu. Isso estava sendo decidido no navegador,
-- comparando `adiado_ate` com o relógio da máquina do atendente.
--
-- ⚠️ Duas coisas erradas nisso, e a segunda é a que importa:
--
-- 1. `Date.now()` durante a renderização é chamada impura — o React reclama, e
--    com razão: duas renderizações do mesmo estado podem dar telas diferentes.
-- 2. E, sobretudo, QUEM decide se o contato voltou para a fila é a fila, que
--    roda no Postgres em UTC. Um notebook com o relógio adiantado mostraria
--    "já pode falar" para um contato que `pegar_proximo_contato` ainda recusa —
--    e o atendente clicaria num contato que a fila não entrega.
--
-- Agora a resposta vem pronta do mesmo relógio que a fila usa.

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
           -- A resposta que a tela precisa, decidida pelo relógio da FILA.
           (c.adiado_ate is not null and c.adiado_ate <= now()) as pode_falar,
           (select m.nome from public.municipios m where m.id = c.municipio_id) as municipio
      from public.contatos c
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
