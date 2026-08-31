-- =============================================================================
-- Subir a lista de novo ATUALIZA o contato, em vez de ignorá-lo
-- =============================================================================
-- ⚠️ ESTE É O DEFEITO QUE PAROU A OPERAÇÃO, e ele se disfarçava de outra coisa.
--
-- A importação gravava com `on conflict (telefone_hmac) do nothing`. Número que
-- já existia era ignorado EM SILÊNCIO e continuava na lista antiga. Então:
--
--   1. o gestor subia a lista corrigida de um atendente;
--   2. como todos os números já existiam, a lista nova nascia com ZERO contatos
--      ("Aline atualizado": 0 importados, 719 na planilha);
--   3. ele desativava a lista velha, achando que a nova a substituía;
--   4. o atendente ficava sem fila — `sem_lista` ou `fila_vazia` — e isso
--      parecia "o painel está bloqueando o atendente".
--
-- Em 29/08 a base tinha 6 listas ativas sem atendente nenhum e 6 atendentes com
-- a lista vazia ou desativada. Nenhuma linha de código estava errada; a regra é
-- que era.
--
-- A REGRA NOVA, decidida com quem opera:
--
--   • o contato é a PESSOA, identificada pelo telefone (`telefone_hmac`). A
--     linha nunca é recriada, então `interacoes`, `contato_candidato`, `links`
--     e todo o histórico continuam apontando para ela;
--   • subir de novo MOVE a pessoa para a lista nova e atualiza nome, primeiro
--     nome e município;
--   • quem ainda NÃO foi abordado volta para a fila, para a lista nova valer;
--   • quem JÁ foi abordado mantém o desfecho. A lista muda, o histórico não.
--
-- O QUE NUNCA MUDA, e é o que mantém isto defensável:
--
--   • `origem` — é a afirmação de COMO chegamos até a pessoa, e alimenta a
--     variável {{origem}} da primeira mensagem. Reimportar não transforma quem
--     se cadastrou no site em "um apoiador me passou seu contato";
--   • quem está em `bloqueios` não entra, não volta e não é tocado. Mensagem
--     depois do pedido de saída é multa POR MENSAGEM;
--   • `telefone_e164` apagado pela purga da LGPD não é ressuscitado;
--   • contato `em_atendimento` na mão de alguém agora não é puxado de volta;
--   • `perdido` (chip morto) não volta — reabordar quem já foi abordado por um
--     número morto é insistência (docs/03-OPERACAO.md §2.5).

alter table public.listas
  add column if not exists total_atualizados int not null default 0;

comment on column public.listas.total_atualizados is
  'Contatos que já existiam e foram movidos para esta lista, com os dados atualizados. '
  'Antes eles eram contados como "duplicados" e descartados.';

-- A versão de 4 argumentos sai: mantê-la ao lado da nova deixaria a chamada com
-- quatro parâmetros ambígua, e o erro só apareceria no meio de uma importação.
drop function if exists public.somar_totais_lista(uuid, int, int, int);

create or replace function public.somar_totais_lista(
  p_lista_id    uuid,
  p_importados  int,
  p_duplicados  int,
  p_bloqueados  int,
  p_atualizados int default 0
)
returns void
language sql security definer set search_path = ''
as $$
  update public.listas
     set total_importados  = total_importados  + greatest(p_importados, 0),
         total_duplicados  = total_duplicados  + greatest(p_duplicados, 0),
         total_bloqueados  = total_bloqueados  + greatest(p_bloqueados, 0),
         total_atualizados = total_atualizados + greatest(p_atualizados, 0)
   where id = p_lista_id;
$$;

-- ── A gravação de um bloco da planilha ──────────────────────────────────────
-- Recebe as linhas já normalizadas e com o HMAC calculado no SERVIDOR (a chave
-- secreta não vai ao navegador). Reentrante: repetir o mesmo bloco não duplica
-- nada e não muda mais nada além do que já mudou.
create or replace function public.importar_contatos(
  p_lista_id uuid,
  p_origem   public.origem_contato,
  p_linhas   jsonb
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_novos       int := 0;
  v_atualizados int := 0;
  v_bloqueados  int := 0;
  v_devolvidos  int := 0;
  v_tocados     uuid[] := '{}';
begin
  -- Quem pediu saída não entra e não é tocado. Primeira trava, antes de tudo.
  select count(*)::int into v_bloqueados
    from jsonb_array_elements(p_linhas) l
   where exists (
     select 1 from public.bloqueios b where b.telefone_hmac = l->>'hmac'
   );

  -- ⚠️ Duas instruções, e não uma com CTEs encadeadas. O Postgres não deixa a
  -- mesma linha ser afetada duas vezes pela MESMA instrução: a devolução à fila
  -- veria o retrato de antes do insert e não faria nada — em silêncio.
  with entrada as (
    -- `distinct on` é cinto e suspensório: o navegador já deduplica dentro do
    -- arquivo, mas duas linhas iguais no mesmo bloco derrubariam o insert
    -- inteiro com "cannot affect row a second time".
    select distinct on (l->>'hmac')
           nullif(btrim(l->>'nome'), '')          as nome,
           nullif(btrim(l->>'primeiro_nome'), '') as primeiro_nome,
           l->>'e164'                             as e164,
           l->>'chave_dedup'                      as chave_dedup,
           l->>'hmac'                             as hmac,
           coalesce((l->>'hmac_versao')::int, 1)  as hmac_versao,
           nullif(l->>'municipio_id', '')::smallint as municipio_id
      from jsonb_array_elements(p_linhas) l
     where not exists (
       select 1 from public.bloqueios b where b.telefone_hmac = l->>'hmac'
     )
  ),
  gravadas as (
    insert into public.contatos as c
      (lista_id, origem, nome, primeiro_nome, telefone_e164, chave_dedup,
       telefone_hmac, hmac_versao, municipio_id, status)
    select p_lista_id, p_origem, e.nome, e.primeiro_nome, e.e164, e.chave_dedup,
           e.hmac, e.hmac_versao, e.municipio_id, 'na_fila'
      from entrada e
    on conflict (telefone_hmac) do update
       set lista_id      = excluded.lista_id,
           -- Nome vazio na planilha nova NÃO apaga o nome que já existia. A
           -- planilha "que veio só com o primeiro nome" foi uma das queixas.
           nome          = coalesce(excluded.nome, c.nome),
           primeiro_nome = coalesce(excluded.primeiro_nome, c.primeiro_nome),
           municipio_id  = coalesce(excluded.municipio_id, c.municipio_id)
           -- `origem` e `telefone_e164` ficam de fora de propósito. Ver o
           -- cabeçalho desta migration.
    returning c.id, (xmax = 0) as novo
  )
  select count(*) filter (where novo)::int,
         count(*) filter (where not novo)::int,
         coalesce(array_agg(id) filter (where not novo), '{}')
    into v_novos, v_atualizados, v_tocados
    from gravadas;

  -- ── Quem volta para a fila ───────────────────────────────────────────────
  if cardinality(v_tocados) > 0 then
    with devolvidos as (
      update public.contatos c
         set status          = 'na_fila',
             atendente_id    = null,
             chip_id         = null,
             claimed_at      = null,
             claim_expira_em = null,
             adiado_ate      = null,
             resultado_em    = null
       where c.id = any(v_tocados)
         -- `na_fila` já está lá; os outros três nunca voltam.
         and c.status not in ('na_fila', 'em_atendimento', 'pediu_saida', 'perdido')
         -- Telefone apagado pela purga da LGPD: a pessoa não é reabordável.
         and c.telefone_e164 is not null
         -- A trava que importa: só volta quem NUNCA recebeu mensagem.
         and not exists (
           select 1 from public.interacoes i
            where i.contato_id = c.id and i.aberto_wa_em is not null
         )
      returning 1
    ) select count(*)::int into v_devolvidos from devolvidos;
  end if;

  perform public.somar_totais_lista(p_lista_id, v_novos, 0, v_bloqueados, v_atualizados);

  return jsonb_build_object(
    'novos',       v_novos,
    'atualizados', v_atualizados,
    'bloqueados',  v_bloqueados,
    'devolvidos',  v_devolvidos
  );
end;
$$;

revoke execute on function public.importar_contatos(uuid, public.origem_contato, jsonb)
  from anon, public, authenticated;
grant execute on function public.importar_contatos(uuid, public.origem_contato, jsonb)
  to service_role;

revoke execute on function public.somar_totais_lista(uuid, int, int, int, int)
  from anon, public, authenticated;
grant execute on function public.somar_totais_lista(uuid, int, int, int, int)
  to service_role;
