-- =============================================================================
-- Textos e convite ao canal no mundo multi-candidato
-- =============================================================================

-- O convite ao canal passa a ser por candidato, com os materiais do tipo
-- 'canal' daquele candidato. Antes ele usava um destino global, que deixou de
-- existir quando cada candidatura ganhou os próprios materiais.
create or replace function public.etapa_por_candidato(p_etapa public.etapa_msg)
returns boolean
language sql immutable
as $$ select p_etapa in ('material', 'convite_grupo'); $$;

create or replace function public.preparar_mensagem(
  p_contato_id   uuid,
  p_chip_id      uuid,
  p_etapa        public.etapa_msg,
  p_candidato_id uuid default null
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
  v_escolhida uuid;
  v_cand      public.candidatos%rowtype;
  v_materiais jsonb;
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

  if public.etapa_por_candidato(p_etapa) then
    if p_candidato_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_obrigatorio');
    end if;

    -- A trava do consentimento: só alcança candidato declarado na permissão.
    if not exists (
      select 1 from public.contato_candidato cc
       where cc.contato_id = p_contato_id and cc.candidato_id = p_candidato_id
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_nao_declarado');
    end if;

    select * into v_cand from public.candidatos where id = p_candidato_id and ativo;
    if v_cand.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_inativo');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'titulo', m.titulo, 'tipo', m.tipo,
             'token', public.garantir_link_material(p_contato_id, m.id)
           ) order by m.ordem, m.titulo), '[]'::jsonb)
      into v_materiais
      from public.materiais m
     where m.candidato_id = p_candidato_id and m.ativo
       -- O convite leva só o canal; o material leva o resto.
       and (case when p_etapa = 'convite_grupo' then m.tipo = 'canal' else true end);
  end if;

  select * into v_modelo from public.modelos where etapa = p_etapa and ativo;
  if v_modelo.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_ausente');
  end if;

  select i.variacao_id into v_escolhida
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa
     and i.candidato_id is not distinct from p_candidato_id;

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
      (contato_id, atendente_id, chip_id, etapa, candidato_id, variacao_id, dia_operacional)
    values
      (p_contato_id, v_uid, p_chip_id, p_etapa, p_candidato_id, v_escolhida, public.hoje_operacional())
    on conflict (contato_id, etapa, candidato_id) do update
      set variacao_id = coalesce(interacoes.variacao_id, excluded.variacao_id)
    returning variacao_id into v_escolhida;
  end if;

  select * into v_variacao from public.variacoes where id = v_escolhida;

  return jsonb_build_object(
    'ok', true,
    'etapa', p_etapa,
    'variacao_id', v_variacao.id,
    'modelo', v_variacao.texto,
    'contato', jsonb_build_object(
      'id', v_contato.id, 'nome', v_contato.nome,
      'primeiro_nome', v_contato.primeiro_nome, 'telefone_e164', v_contato.telefone_e164
    ),
    'atendente_nome', v_usuario.primeiro_nome,
    'timezone', v_cfg.timezone,
    'municipio', (select m.nome from public.municipios m where m.id = v_contato.municipio_id),
    'chapa', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ch.candidato_id, 'nome', ch.nome_urna, 'cargo', ch.cargo,
               'numero', ch.numero, 'partido', ch.partido_sigla, 'principal', ch.principal
             ))
        from public.chapa_do_atendente(v_uid) ch
    ), '[]'::jsonb),
    'candidato', case when v_cand.id is null then null else jsonb_build_object(
      'id', v_cand.id, 'nome', v_cand.nome_urna, 'cargo', v_cand.cargo,
      'numero', v_cand.numero, 'partido', v_cand.partido_sigla,
      'cnpj', v_cand.cnpj_campanha
    ) end,
    'materiais', coalesce(v_materiais, '[]'::jsonb)
  );
end;
$$;

-- Idem para a abertura: o convite também é por candidato declarado.
create or replace function public.registrar_abertura(
  p_contato_id   uuid,
  p_chip_id      uuid,
  p_etapa        public.etapa_msg,
  p_texto        text default null,
  p_variacao_id  uuid default null,
  p_candidato_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_cfg public.config%rowtype;
  v_hoje date := public.hoje_operacional();
  v_hora int := public.hora_local();
  v_chip public.chips%rowtype;
  v_contato public.contatos%rowtype;
  v_antes timestamptz;
  v_id uuid;
  v_declarados int := 0;
begin
  select * into v_cfg from public.config where id = 1;
  select * into v_chip from public.chips where id = p_chip_id;
  select * into v_contato from public.contatos where id = p_contato_id;

  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;
  if v_chip.status in ('pausado', 'morto') then
    return jsonb_build_object('ok', false, 'motivo', 'chip_indisponivel');
  end if;
  if exists (select 1 from public.dias_bloqueados d where d.data = v_hoje) then
    return jsonb_build_object('ok', false, 'motivo', 'dia_bloqueado');
  end if;
  if v_hora < v_cfg.hora_inicio or v_hora >= v_cfg.hora_fim then
    return jsonb_build_object('ok', false, 'motivo', 'fora_de_horario');
  end if;
  if p_etapa <> 'saida'
     and exists (select 1 from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_bloqueado');
  end if;
  if v_contato.telefone_e164 is null then
    return jsonb_build_object('ok', false, 'motivo', 'dados_apagados');
  end if;

  if public.etapa_por_candidato(p_etapa) then
    if p_candidato_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_obrigatorio');
    end if;
    if not exists (
      select 1 from public.contato_candidato cc
       where cc.contato_id = p_contato_id and cc.candidato_id = p_candidato_id
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_nao_declarado');
    end if;
  end if;

  select i.aberto_wa_em into v_antes
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa
     and i.candidato_id is not distinct from p_candidato_id;

  insert into public.interacoes
    (contato_id, atendente_id, chip_id, etapa, candidato_id, variacao_id,
     texto_enviado, aberto_wa_em, dia_operacional)
  values
    (p_contato_id, v_uid, p_chip_id, p_etapa, p_candidato_id, p_variacao_id,
     p_texto, now(), v_hoje)
  on conflict (contato_id, etapa, candidato_id) do update
     set aberto_wa_em  = coalesce(interacoes.aberto_wa_em, excluded.aberto_wa_em),
         texto_enviado = coalesce(interacoes.texto_enviado, excluded.texto_enviado),
         variacao_id   = coalesce(interacoes.variacao_id, excluded.variacao_id),
         chip_id       = coalesce(interacoes.chip_id, excluded.chip_id)
  returning id into v_id;

  -- O congelamento do consentimento: o que foi declarado, no momento do envio.
  if p_etapa = 'permissao' then
    with declarados as (
      insert into public.contato_candidato (contato_id, candidato_id, atendente_id, chip_id)
      select p_contato_id, ch.candidato_id, v_uid, p_chip_id
        from public.chapa_do_atendente(v_uid) ch
      on conflict (contato_id, candidato_id) do nothing
      returning 1
    ) select count(*)::int into v_declarados from declarados;
  end if;

  if p_etapa = 'material' then
    update public.contato_candidato
       set material_enviado_em = coalesce(material_enviado_em, now()),
           atendente_id = coalesce(atendente_id, v_uid),
           chip_id      = coalesce(chip_id, p_chip_id)
     where contato_id = p_contato_id and candidato_id = p_candidato_id;
  end if;

  update public.contatos
     set primeiro_contato_em = coalesce(primeiro_contato_em, now()),
         chip_id = coalesce(chip_id, p_chip_id)
   where id = p_contato_id;

  return jsonb_build_object(
    'ok', true,
    'ja_registrado', v_antes is not null,
    'interacao_id', v_id,
    'candidatos_declarados', v_declarados,
    'fila', public.fila_status(p_chip_id)
  );
end;
$$;

-- ── Textos ────────────────────────────────────────────────────────────────
-- A Permissão passa a declarar a chapa inteira: é o que faz o "pode" da pessoa
-- cobrir tudo que ela vai receber. O Material passa a se identificar sozinho,
-- porque chega separado e possivelmente dias depois.
delete from public.variacoes
 where modelo_id in (select id from public.modelos where etapa in ('permissao','material','quem_passou','convite_grupo'));

insert into public.variacoes (modelo_id, texto, ordem)
select m.id, v.texto, v.ordem
from public.modelos m
join (values
  ('permissao', 1, '{{saudacao}}, {{primeiro_nome}}! Tudo bem? Aqui é {{nome}}. Tô ajudando {{candidatos}} nessa eleição, e um apoiador me passou seu contato. Posso te mandar o material aqui? Se não quiser, me fala que eu paro por aqui e apago seu número, tranquilo.'),
  ('permissao', 2, 'Oi, {{primeiro_nome}}, {{saudacao}}! Sou {{nome}}. Tô nessa eleição com {{candidatos}}. Um apoiador me passou seu contato. Tudo bem se eu te mandar as propostas? Se preferir não receber, é só me dizer que apago seu contato.'),
  ('permissao', 3, '{{saudacao}}, {{primeiro_nome}}, tudo certo? {{nome}} aqui. Tô dando uma força pra {{candidatos}}, e um apoiador me indicou seu contato. Posso te mostrar o material por aqui? Se não quiser, sem problema, me avisa que apago seu número.'),
  ('permissao', 4, '{{saudacao}}, {{primeiro_nome}}! Aqui é {{nome}}. Tô ajudando {{candidatos}} e um apoiador me passou seu contato. Te mando o material? Se não quiser, me fala que apago seu número e não te chamo mais.'),
  ('permissao', 5, 'Oi, {{primeiro_nome}}, {{saudacao}}, tudo bem por aí? Eu sou {{nome}}, tô nessa eleição ajudando {{candidatos}}. Um apoiador me passou seu contato. Posso te mandar as propostas aqui no WhatsApp? Se preferir que não, me fala que apago seu contato, de boa.'),
  ('material', 1, 'Que bom, {{primeiro_nome}}! Esse é o material de {{candidato}}, {{cargo}}, número {{numero}}:
{{materiais}}
Se um dia não quiser mais receber, me avisa que apago seu contato.
Propaganda de {{candidato}} — CNPJ {{cnpj}}'),
  ('quem_passou', 1, 'Foi um apoiador que tem seu contato e me passou. Se preferir, apago seu número agora e não te chamo mais.'),
  ('convite_grupo', 1, 'Tem sim! Eu não adiciono ninguém, você entra pelo link, assim fica no seu controle:
{{materiais}}
Se um dia quiser sair, é só sair.')
) as v(etapa, ordem, texto) on v.etapa = m.etapa::text;
