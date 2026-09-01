-- =============================================================================
-- O nome completo volta às telas que servem para IDENTIFICAR alguém
-- =============================================================================
-- Relatado por quem opera, com print: buscando "Espetinho" na folha de escolher
-- contato, apareciam CINCO linhas escritas "Espetinho". Na planilha eram
-- "Espetinho Andreia", "Espetinho Delegado", "Espetinho Esmerindo", "Espetinho
-- Mariano" e um "Espetinho" seco.
--
-- ⚠️ O DADO ESTAVA CERTO. `contatos.nome` guarda o nome completo, e a
-- importação nunca o perdeu — conferido nos cinco. O que se perdia era na
-- exibição: a folha mostrava `coalesce(primeiro_nome, nome)`.
--
-- A distinção que faltava, e que vale para o painel inteiro:
--
--   MENSAGEM      → primeiro nome. "Oi, Espetinho!" é como se fala com gente.
--   IDENTIFICAÇÃO → nome completo. É o que separa uma pessoa da outra.
--
-- Numa tela cujo propósito é ESCOLHER quem atender, o primeiro nome apaga
-- exatamente o que distingue — e a lista vira cinco linhas iguais.
--
-- `{{primeiro_nome}}` das mensagens não muda: sai de `contato_json`, que
-- devolve os dois campos separados, e continua sendo o primeiro nome.

create or replace function public.fila_do_atendente(p_lista_id uuid DEFAULT NULL::uuid, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_busca   text;
  v_r       jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('erro', 'sem_sessao');
  end if;

  p_limite := least(greatest(coalesce(p_limite, 40), 1), 100);
  v_busca  := nullif(btrim(coalesce(p_busca, '')), '');

  if p_lista_id is not null and not exists (
    select 1 from public.atendente_listas al
     join public.listas l on l.id = al.lista_id
    where al.atendente_id = v_uid and al.lista_id = p_lista_id and l.ativa
  ) then
    return jsonb_build_object('erro', 'lista_nao_e_sua');
  end if;

  -- ⚠️ `t.ordem`, e não `x.ordem`: `x` é a coluna jsonb, `t` é a subconsulta.
  -- Ver o cabeçalho — este erro derrubou a tela inteira.
  select coalesce(jsonb_agg(t.x order by t.ordem), '[]'::jsonb) into v_r
    from (
      select jsonb_build_object(
               'id', c.id,
               -- ⚠️ NOME COMPLETO, e não o primeiro. Esta é uma tela de
               -- ESCOLHA: com `coalesce(primeiro_nome, nome)` a busca por
               -- "Espetinho" devolvia cinco linhas escritas "Espetinho", e o
               -- atendente não tinha como saber qual era o Delegado, qual era
               -- o Esmerindo e qual era o Mariano. O primeiro nome serve para
               -- a MENSAGEM ("Oi, Espetinho!"); para identificar gente numa
               -- lista, ele apaga justamente o que distingue.
               'nome', coalesce(nullif(btrim(c.nome), ''), c.primeiro_nome),
               'telefone_e164', c.telefone_e164,
               'origem', c.origem,
               'municipio', (select m.nome from public.municipios m where m.id = c.municipio_id),
               'lista_id', c.lista_id,
               'lista', (select l.rotulo from public.listas l where l.id = c.lista_id),
               'criado_em', c.criado_em,
               'reagendado', c.status = 'falar_depois'
             ) as x,
             row_number() over (
               order by (c.status = 'falar_depois') desc,
                        (c.atendente_id = v_uid) desc nulls last,
                        (c.origem = 'lista_fria'),
                        c.criado_em
             ) as ordem
        from public.contatos c
       where public.status_entregavel(c.status, c.atendente_id, v_uid)
         and c.telefone_e164 is not null
         and (c.atendente_id is null or c.atendente_id = v_uid)
         and (c.adiado_ate is null or c.adiado_ate <= now())
         and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac)
         and (
           c.candidato_origem_id is null
           or exists (
             select 1 from public.atendente_candidatos ac
              where ac.atendente_id = v_uid and ac.candidato_id = c.candidato_origem_id
           )
         )
         and (
           c.lista_id is null
           or exists (
             select 1
               from public.atendente_listas al
               join public.listas l on l.id = al.lista_id
              where al.atendente_id = v_uid
                and al.lista_id = c.lista_id
                and l.ativa
           )
         )
         and (p_lista_id is null or c.lista_id = p_lista_id)
         -- Busca só por NOME. Ver o cabeçalho.
         and (v_busca is null or c.nome ilike '%' || v_busca || '%')
       order by ordem
       limit p_limite
    ) t;

  return jsonb_build_object('ok', true, 'linhas', v_r);
end;
$function$;
