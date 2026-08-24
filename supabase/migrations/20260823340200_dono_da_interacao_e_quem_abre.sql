-- =============================================================================
-- A conversa passa a ser de quem ABRIU, não de quem preparou
-- =============================================================================
-- ⚠️ O envio de um atendente era debitado do teto e do número de OUTRO.
--
-- `preparar_mensagem` cria a linha de `interacoes` assim que a tela monta o
-- texto — para fixar a variação e não trocar a mensagem embaixo do atendente.
-- Essa linha nasce com o `atendente_id` e o `chip_id` de quem preparou.
--
-- Só que o contato pode trocar de mão antes de alguém falar com ele. São dois
-- caminhos comuns, os dois de primeira classe na interface:
--
--   • "Deixar este para depois e buscar outro contato" devolve o contato à fila;
--   • a reserva de 20 minutos vence e o cron `expirar_leases` devolve sozinho.
--
-- Quando o próximo atendente abria a conversa, o `on conflict` preservava tudo
-- com `coalesce` — e `atendente_id` não era nem tocado. O resultado:
--
--   • o envio contava no teto do PRIMEIRO chip, não no de quem falou;
--   • quem falou podia passar do próprio teto, porque o dele não subia;
--   • o log de auditoria — a prova de quem disse o que a quem — nomeava a
--     pessoa errada;
--   • `v_desempenho_atendente` creditava a pessoa errada;
--   • e o RLS de `interacoes` escondia a interação de quem acabou de criá-la.
--
-- Junto vinha um terceiro efeito, mais silencioso: `dia_operacional` também
-- ficava congelado no dia do rascunho. Uma mensagem preparada às 19h e enviada
-- às 9h do dia seguinte era contada no teto de ONTEM — ou seja, não era contada.
--
-- A regra agora tem uma frase: **enquanto `aberto_wa_em` é nulo, a linha é um
-- rascunho e pertence a quem preparou; no instante em que alguém abre, ela
-- passa a pertencer a quem abriu, com o chip e o dia de quem abriu.** Depois de
-- aberta continua imutável, que é o que mantém o duplo clique idempotente.

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
  v_uid        uuid := (select auth.uid());
  v_cfg        public.config%rowtype;
  v_hoje       date := public.hoje_operacional();
  v_hora       int  := public.hora_local();
  v_chip       public.chips%rowtype;
  v_contato    public.contatos%rowtype;
  v_antes      timestamptz;
  v_id         uuid;
  v_declarados int := 0;
  v_rampa      record;
  v_enviados   int;
  v_ja_conta   boolean;
  v_ultimo     timestamptz;
  v_espera     int;
begin
  select * into v_cfg     from public.config where id = 1;
  select * into v_chip    from public.chips where id = p_chip_id;
  select * into v_contato from public.contatos where id = p_contato_id;

  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;
  if v_chip.status in ('pausado', 'morto')
     or (v_chip.pausado_ate is not null and v_chip.pausado_ate > now()) then
    return jsonb_build_object('ok', false, 'motivo', 'chip_indisponivel');
  end if;
  if exists (select 1 from public.dias_bloqueados d where d.data = v_hoje) then
    return jsonb_build_object('ok', false, 'motivo', 'dia_bloqueado');
  end if;
  if v_hora < v_cfg.hora_inicio or v_hora >= v_cfg.hora_fim then
    return jsonb_build_object('ok', false, 'motivo', 'fora_de_horario');
  end if;
  -- Bloqueado não recebe mensagem. Exceção única: a confirmação de saída.
  if p_etapa <> 'saida'
     and exists (select 1 from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_bloqueado');
  end if;
  if v_contato.telefone_e164 is null then
    return jsonb_build_object('ok', false, 'motivo', 'dados_apagados');
  end if;

  -- Material só sai para candidato declarado na permissão daquele contato.
  if p_etapa = 'material' then
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

  -- Estado ANTES da gravação: responde "já tinha aberto?".
  select i.aberto_wa_em into v_antes
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa
     and i.candidato_id is not distinct from p_candidato_id;

  -- ── Ritmo do chip ─────────────────────────────────────────────────────────
  -- Só para abertura de verdade. Reabrir o que já foi aberto não gera mensagem
  -- nova, então não pode ser recusado por teto nem por intervalo.
  if v_antes is null then
    select * into v_rampa from public.rampa_do_chip(p_chip_id);

    select count(distinct i.contato_id)::int into v_enviados
      from public.interacoes i
     where i.chip_id = p_chip_id
       and i.dia_operacional = v_hoje
       and i.aberto_wa_em is not null;

    -- Esta pessoa já entrou na conta de hoje deste chip?
    select exists (
      select 1 from public.interacoes i
       where i.chip_id = p_chip_id
         and i.dia_operacional = v_hoje
         and i.contato_id = p_contato_id
         and i.aberto_wa_em is not null
    ) into v_ja_conta;

    if not v_ja_conta and coalesce(v_enviados, 0) >= v_rampa.teto then
      return jsonb_build_object(
        'ok', false, 'motivo', 'teto_atingido',
        'enviados_hoje', coalesce(v_enviados, 0), 'teto_hoje', v_rampa.teto
      );
    end if;

    if public.etapa_de_abordagem(p_etapa) then
      select max(i.aberto_wa_em) into v_ultimo
        from public.interacoes i
       where i.chip_id = p_chip_id
         and i.dia_operacional = v_hoje
         and i.aberto_wa_em is not null
         and public.etapa_de_abordagem(i.etapa);

      if v_ultimo is not null then
        v_espera := v_rampa.intervalo_seg - floor(extract(epoch from (now() - v_ultimo)))::int;
        if v_espera > 0 then
          return jsonb_build_object(
            'ok', false, 'motivo', 'intervalo', 'segundos_espera', v_espera
          );
        end if;
      end if;
    end if;
  end if;

  insert into public.interacoes
    (contato_id, atendente_id, chip_id, etapa, candidato_id, variacao_id,
     texto_enviado, aberto_wa_em, dia_operacional)
  values
    (p_contato_id, v_uid, p_chip_id, p_etapa, p_candidato_id, p_variacao_id,
     p_texto, now(), v_hoje)
  on conflict (contato_id, etapa, candidato_id) do update
     -- Depois de aberta, a linha é imutável: duplo clique não muda horário,
     -- nem texto, nem variação. É isso que torna "Abrir conversa" idempotente.
     set aberto_wa_em  = coalesce(interacoes.aberto_wa_em, excluded.aberto_wa_em),
         texto_enviado = coalesce(interacoes.texto_enviado, excluded.texto_enviado),
         variacao_id   = coalesce(interacoes.variacao_id, excluded.variacao_id),
         -- ⚠️ ANTES DE ABERTA, ela é só um rascunho de `preparar_mensagem` — e
         -- o rascunho pertence a quem preparou, não a quem vai falar. Quem ABRE
         -- é o dono. Ver o cabeçalho desta migration.
         atendente_id  = case when interacoes.aberto_wa_em is null
                              then excluded.atendente_id else interacoes.atendente_id end,
         chip_id       = case when interacoes.aberto_wa_em is null
                              then excluded.chip_id else interacoes.chip_id end,
         -- O dia também é do envio, não do rascunho: preparado às 19h e aberto
         -- às 9h do dia seguinte, a conversa é de hoje e conta no teto de hoje.
         dia_operacional = case when interacoes.aberto_wa_em is null
                                then excluded.dia_operacional else interacoes.dia_operacional end
  returning id into v_id;

  -- ── O CONGELAMENTO DO CONSENTIMENTO ──────────────────────────────────────
  -- No instante em que a permissão é enviada, grava-se quais candidatos foram
  -- declarados àquela pessoa. É isso que a resposta dela cobre.
  if p_etapa = 'permissao' then
    with declarados as (
      insert into public.contato_candidato
        (contato_id, candidato_id, atendente_id, chip_id)
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
  v_pagina    text;
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

  -- ── As recusas duras, ANTES de montar o texto ────────────────────────────
  -- Estas travas já existiam em `registrar_abertura`, e só lá. O problema é
  -- que, quando elas disparavam, o atendente já estava com o texto na tela e a
  -- janela do WhatsApp aberta — a recusa chegava como aviso, não como trava.
  --
  -- Montar uma mensagem que o servidor vai recusar é entregar munição para o
  -- erro: o texto está pronto, a conversa está aberta, e o que separa o envio
  -- de acontecer é a disciplina de quem está com pressa. Recusar aqui é o que
  -- faz o painel simplesmente não ter mensagem para mostrar.
  if v_chip.status in ('pausado', 'morto')
     or (v_chip.pausado_ate is not null and v_chip.pausado_ate > now()) then
    return jsonb_build_object('ok', false, 'motivo', 'chip_indisponivel');
  end if;
  if exists (select 1 from public.dias_bloqueados d where d.data = public.hoje_operacional()) then
    return jsonb_build_object('ok', false, 'motivo', 'dia_bloqueado');
  end if;
  if public.hora_local() < v_cfg.hora_inicio or public.hora_local() >= v_cfg.hora_fim then
    return jsonb_build_object('ok', false, 'motivo', 'fora_de_horario');
  end if;
  -- Bloqueado não recebe mensagem. Exceção única, a mesma de sempre: a
  -- confirmação de saída, que é o que a pessoa pediu para ouvir.
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
       and (case when p_etapa = 'convite_grupo' then m.tipo = 'canal' else true end);

    v_pagina := public.garantir_link_candidato(p_contato_id, p_candidato_id);
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
      set variacao_id = coalesce(interacoes.variacao_id, excluded.variacao_id),
          -- Rascunho que ainda não virou conversa muda de dono junto com o
          -- contato. Depois de aberto, nada aqui se mexe.
          atendente_id = case when interacoes.aberto_wa_em is null
                              then excluded.atendente_id else interacoes.atendente_id end,
          chip_id      = case when interacoes.aberto_wa_em is null
                              then excluded.chip_id else interacoes.chip_id end,
          dia_operacional = case when interacoes.aberto_wa_em is null
                                 then excluded.dia_operacional else interacoes.dia_operacional end
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
      'primeiro_nome', v_contato.primeiro_nome, 'telefone_e164', v_contato.telefone_e164,
      'origem', v_contato.origem
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
    'materiais', coalesce(v_materiais, '[]'::jsonb),
    'pagina_token', v_pagina
  );
end;
$$;
