-- =============================================================================
-- Preparação da mensagem e links rastreados
-- =============================================================================

-- ── Token do link ───────────────────────────────────────────────────────────
-- 12 caracteres URL-safe, 72 bits de entropia, vindo de gen_random_bytes
-- (CSPRNG) e não de random(), que é previsível.
--
-- ⚠️ O token NÃO carrega dado nenhum: é aleatório e aponta para o contato no
-- banco. Telefone e nome jamais entram numa URL.
create or replace function public.gerar_token()
returns text
language sql volatile security definer set search_path = ''
as $$
  select translate(encode(extensions.gen_random_bytes(9), 'base64'), '+/=', '-_');
$$;

-- Cria o link do contato para um destino, ou devolve o que já existe.
-- Criado sob demanda: gerar 2 tokens para 10.000 contatos que talvez nunca
-- cheguem à etapa de material é lixo no banco.
create or replace function public.garantir_link(p_contato_id uuid, p_destino_chave text)
returns text
language plpgsql security definer set search_path = ''
as $$
declare
  v_destino uuid;
  v_token   text;
begin
  select id into v_destino from public.destinos where chave = p_destino_chave;
  if v_destino is null then return null; end if;

  select token into v_token from public.links
   where contato_id = p_contato_id and destino_id = v_destino;
  if v_token is not null then return v_token; end if;

  for _ in 1..5 loop
    begin
      insert into public.links (token, contato_id, destino_id)
      values (public.gerar_token(), p_contato_id, v_destino)
      returning token into v_token;
      return v_token;
    exception when unique_violation then
      -- colisão de token (praticamente impossível) ou corrida com outra
      -- sessão preparando a mesma mensagem
      select token into v_token from public.links
       where contato_id = p_contato_id and destino_id = v_destino;
      if v_token is not null then return v_token; end if;
    end;
  end loop;
  return null;
end;
$$;

-- ── Preparar a mensagem de uma etapa ────────────────────────────────────────
-- Devolve o MODELO (com as variáveis ainda como {{...}}); quem substitui é o
-- servidor Next, com src/lib/mensagem.ts — a mesma função que os testes cobrem.
--
-- A variação escolhida é gravada na interação AGORA, com aberto_wa_em nulo.
-- Isso faz duas coisas: recarregar a tela devolve o MESMO texto (o atendente
-- não vê a mensagem mudar embaixo dele), e a rotação avança exatamente uma vez
-- por contato+etapa.
create or replace function public.preparar_mensagem(
  p_contato_id uuid,
  p_chip_id    uuid,
  p_etapa      public.etapa_msg
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_cfg       public.config%rowtype;
  v_contato   public.contatos%rowtype;
  v_chip      public.chips%rowtype;
  v_usuario   public.usuarios%rowtype;
  v_modelo    public.modelos%rowtype;
  v_variacao  public.variacoes%rowtype;
  v_ultima    uuid;
  v_ja        uuid;
  v_link      text;
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

  -- Já existe variação escolhida para este contato+etapa? Reaproveita.
  select i.variacao_id into v_ja
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa;

  if v_ja is not null then
    select * into v_variacao from public.variacoes where id = v_ja;
  end if;

  if v_variacao.id is null then
    -- Rotação POR CHIP: o antispam olha o número, não o atendente. O mesmo
    -- número mandando texto idêntico em sequência é o padrão de disparo.
    select ultima_variacao_id into v_ultima
      from public.rotacao_chip
     where chip_id = p_chip_id and modelo_id = v_modelo.id;

    select * into v_variacao from (
      select v.*, row_number() over (order by v.ordem, v.id) as pos
        from public.variacoes v
       where v.modelo_id = v_modelo.id and v.ativa
    ) t
    where t.pos = (
      coalesce(
        (select (row_number() over (order by v2.ordem, v2.id))
           from public.variacoes v2
          where v2.modelo_id = v_modelo.id and v2.ativa and v2.id = v_ultima
          limit 1),
        0
      ) % (select count(*) from public.variacoes where modelo_id = v_modelo.id and ativa)
    ) + 1;

    if v_variacao.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_variacao');
    end if;

    insert into public.rotacao_chip (chip_id, modelo_id, ultima_variacao_id)
    values (p_chip_id, v_modelo.id, v_variacao.id)
    on conflict (chip_id, modelo_id)
      do update set ultima_variacao_id = excluded.ultima_variacao_id, atualizado_em = now();

    insert into public.interacoes
      (contato_id, atendente_id, chip_id, etapa, variacao_id, dia_operacional)
    values
      (p_contato_id, v_uid, p_chip_id, p_etapa, v_variacao.id, public.hoje_operacional())
    on conflict (contato_id, etapa) do update
      set variacao_id = coalesce(interacoes.variacao_id, excluded.variacao_id);
  end if;

  -- Links só nas etapas que os usam. A Permissão NUNCA leva link.
  if p_etapa in ('material') then
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

revoke execute on function public.preparar_mensagem(uuid, uuid, public.etapa_msg) from anon, public;
revoke execute on function public.garantir_link(uuid, text) from anon, public, authenticated;
revoke execute on function public.gerar_token() from anon, public, authenticated;
grant  execute on function public.preparar_mensagem(uuid, uuid, public.etapa_msg) to authenticated;
