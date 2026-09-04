-- =============================================================================
-- A página do material diz de quem ela é
-- =============================================================================
-- Um campo só: `candidato.id`. Ele existe para o desvio ao domínio próprio —
-- quem abrir um /m/ antigo, no endereço da Vercel, precisa ser mandado para
-- `material.sofiaandrade.com.br`, e para isso a página tem de saber de quem é
-- antes de renderizar.
--
-- O corpo abaixo é o que estava no banco, com essa linha a mais.

CREATE OR REPLACE FUNCTION public.pagina_material(p_token text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_link    public.links%rowtype;
  v_cand_id uuid;
  v_cand    public.candidatos%rowtype;
  v_contato public.contatos%rowtype;
begin
  select * into v_link from public.links where token = p_token;
  if v_link.token is null then
    return jsonb_build_object('ok', false, 'motivo', 'token_desconhecido');
  end if;

  -- O alvo pode ser a página do candidato ou uma peça dele. Nos dois casos, o
  -- que a página mostra é a candidatura inteira.
  v_cand_id := coalesce(
    v_link.candidato_id,
    (select m.candidato_id from public.materiais m where m.id = v_link.material_id)
  );

  select * into v_cand from public.candidatos where id = v_cand_id;
  if v_cand.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'candidato_ausente');
  end if;

  select * into v_contato from public.contatos where id = v_link.contato_id;

  return jsonb_build_object(
    'ok', true,
    'contato_id', v_link.contato_id,
    -- Quem já pediu para sair vê a confirmação, não o material de novo.
    'descadastrado', exists (
      select 1 from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac
    ),
    'candidato', jsonb_build_object(
      -- De quem é esta página. Serve para o desvio ao domínio próprio do
      -- candidato: sem ele, quem abre um /m/ antigo fica no endereço velho.
      'id', v_cand.id,
      'nome_urna', v_cand.nome_urna,
      'cargo', v_cand.cargo,
      'numero', v_cand.numero,
      'partido_sigla', v_cand.partido_sigla,
      'coligacao', v_cand.coligacao,
      'cnpj_campanha', v_cand.cnpj_campanha,
      'responsavel_material', v_cand.responsavel_material,
      'foto_url', v_cand.foto_url,
      'cor_tema', v_cand.cor_tema,
      'slogan', v_cand.slogan,
      'chamada', v_cand.chamada,
      'propostas', v_cand.propostas,
      'ativo', v_cand.ativo
    ),
    'materiais', coalesce((
      select jsonb_agg(jsonb_build_object(
               'titulo', m.titulo,
               'descricao', m.descricao,
               'tipo', m.tipo,
               'token', public.garantir_link_material(v_link.contato_id, m.id)
             ) order by m.ordem, m.titulo)
        from public.materiais m
       where m.candidato_id = v_cand.id and m.ativo
    ), '[]'::jsonb)
  );
end;
$function$;
