-- =============================================================================
-- Rotação de variação: reescrita legível
-- =============================================================================
-- A versão anterior usava row_number() dentro de uma subconsulta correlacionada
-- que ninguém consegue auditar de cabeça. Esta espelha exatamente
-- `proximaVariacao` de src/lib/mensagem.ts: pega a lista ordenada, acha a
-- última usada, avança circularmente.

create or replace function public.proxima_variacao(p_modelo_id uuid, p_ultima uuid)
returns uuid
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_ids uuid[];
  v_pos int;
begin
  select array_agg(v.id order by v.ordem, v.id) into v_ids
    from public.variacoes v
   where v.modelo_id = p_modelo_id and v.ativa;

  if v_ids is null or cardinality(v_ids) = 0 then
    return null;
  end if;

  -- Sem histórico, ou variação que foi removida do modelo: começa da primeira.
  v_pos := coalesce(array_position(v_ids, p_ultima), 0);

  -- Avanço circular. Com mais de uma variação, nunca repete a anterior.
  return v_ids[(v_pos % cardinality(v_ids)) + 1];
end;
$$;

create or replace function public.preparar_mensagem(
  p_contato_id uuid,
  p_chip_id    uuid,
  p_etapa      public.etapa_msg
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid        uuid := (select auth.uid());
  v_cfg        public.config%rowtype;
  v_contato    public.contatos%rowtype;
  v_chip       public.chips%rowtype;
  v_usuario    public.usuarios%rowtype;
  v_modelo     public.modelos%rowtype;
  v_variacao   public.variacoes%rowtype;
  v_escolhida  uuid;
  v_link       text;
  v_link_grupo text;
begin
  select * into v_cfg     from public.config where id = 1;
  select * into v_contato from public.contatos where id = p_contato_id;
  select * into v_chip    from public.chips where id = p_chip_id;
  select * into v_usuario from public.usuarios where id = v_uid;

  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;

  select * into v_modelo from public.modelos where etapa = p_etapa and ativo;
  if v_modelo.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_ausente');
  end if;

  -- Variação já escolhida para este contato+etapa? Reaproveita, para que
  -- recarregar a tela não troque o texto embaixo do atendente.
  select i.variacao_id into v_escolhida
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa;

  if v_escolhida is null then
    v_escolhida := public.proxima_variacao(
      v_modelo.id,
      (select r.ultima_variacao_id from public.rotacao_chip r
        where r.chip_id = p_chip_id and r.modelo_id = v_modelo.id)
    );

    if v_escolhida is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_variacao');
    end if;

    insert into public.rotacao_chip (chip_id, modelo_id, ultima_variacao_id)
    values (p_chip_id, v_modelo.id, v_escolhida)
    on conflict (chip_id, modelo_id)
      do update set ultima_variacao_id = excluded.ultima_variacao_id, atualizado_em = now();

    insert into public.interacoes
      (contato_id, atendente_id, chip_id, etapa, variacao_id, dia_operacional)
    values
      (p_contato_id, v_uid, p_chip_id, p_etapa, v_escolhida, public.hoje_operacional())
    on conflict (contato_id, etapa) do update
      set variacao_id = coalesce(interacoes.variacao_id, excluded.variacao_id)
    returning variacao_id into v_escolhida;
  end if;

  select * into v_variacao from public.variacoes where id = v_escolhida;

  -- Links só nas etapas que os usam. A Permissão NUNCA leva link.
  if p_etapa = 'material' then
    v_link := public.garantir_link(p_contato_id, 'material');
  end if;
  if p_etapa in ('material', 'convite_grupo') then
    v_link_grupo := public.garantir_link(p_contato_id, 'canal');
  end if;

  return jsonb_build_object(
    'ok', true,
    'etapa', p_etapa,
    'variacao_id', v_variacao.id,
    'modelo', v_variacao.texto,
    'contato', jsonb_build_object(
      'id', v_contato.id,
      'nome', v_contato.nome,
      'primeiro_nome', v_contato.primeiro_nome,
      'telefone_e164', v_contato.telefone_e164
    ),
    'atendente_nome', v_usuario.primeiro_nome,
    'candidato', v_cfg.candidato,
    'cargo',     v_cfg.cargo,
    'numero',    v_cfg.numero,
    'timezone',  v_cfg.timezone,
    'municipio', (select m.nome from public.municipios m where m.id = v_contato.municipio_id),
    'token_material', v_link,
    'token_canal',    v_link_grupo
  );
end;
$$;

revoke execute on function public.proxima_variacao(uuid, uuid) from anon, public, authenticated;
