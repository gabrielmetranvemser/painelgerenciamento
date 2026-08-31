-- =============================================================================
-- A conferência da importação para de mentir em listas grandes
-- =============================================================================
-- ⚠️ DEFEITO SILENCIOSO, E DOS CAROS. A tela "Confira antes de confirmar" dizia
-- "0 já na base" para QUALQUER planilha com mais de ~230 linhas — inclusive
-- quando metade dos números já estava lá.
--
-- A causa: `conferirBloco` perguntava com
--
--     supabase.from('contatos').select(...).in('telefone_hmac', hashes)
--
-- em blocos de 500. Um `.in()` do PostgREST vai na URL, e cada HMAC tem 64
-- caracteres — 500 deles passam de 32 mil caracteres. O servidor devolve
-- "Bad Request", e o código lia só `{ data }`, sem olhar o `error`. `data` vinha
-- nulo, o contador somava zero, e a tela anunciava um número inventado com toda
-- a confiança do mundo.
--
-- Medido em 31/08 contra o projeto real: passa até ~230 hashes e quebra de 240
-- em diante. Ou seja, funcionava só nos testes com planilha pequena.
--
-- Isso alimentou a confusão de "importei e ficou zerada": o gestor via
-- "1.167 pessoas novas" na conferência, importava, e o resultado era outro.
--
-- A correção não é diminuir o bloco — é parar de mandar dado por URL. Esta
-- função recebe os hashes no CORPO da requisição, onde não há limite prático, e
-- devolve a contagem pronta. Mesmo caminho que `importar_contatos` já usa para
-- gravar.
create or replace function public.conferir_importacao(p_hashes jsonb)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  with entrada as (
    select distinct jsonb_array_elements_text(p_hashes) as hmac
  ),
  classificado as (
    select e.hmac,
           exists (select 1 from public.bloqueios b where b.telefone_hmac = e.hmac) as bloqueado,
           exists (select 1 from public.contatos c where c.telefone_hmac = e.hmac)  as existe
      from entrada e
  )
  select jsonb_build_object(
    -- Um número bloqueado que também já é contato conta UMA vez, como
    -- bloqueado: é o motivo mais forte e o que o gestor precisa ver.
    'ja_existem', count(*) filter (where existe and not bloqueado)::int,
    'bloqueados', count(*) filter (where bloqueado)::int
  )
  from classificado;
$$;

revoke execute on function public.conferir_importacao(jsonb) from anon, public, authenticated;
grant  execute on function public.conferir_importacao(jsonb) to service_role;
