-- =============================================================================
-- O teto do dia e o intervalo passam a valer no ENVIO, não só na fila
-- =============================================================================
-- ⚠️ As duas travas que protegem o número do atendente estavam num lugar só —
--    `pegar_proximo_contato` — e esse lugar governa apenas contato NOVO.
--
-- `registrar_abertura`, que é a função correspondente a uma mensagem saindo de
-- verdade, conferia horário, dia bloqueado, chip e bloqueio, mas NÃO conferia
-- teto nem intervalo. Três caminhos já abertos na interface passavam por fora:
--
--   • a fase de entrega: depois de "Autorizou", o painel oferece um botão de
--     material por candidato declarado. Seis candidatos = seis mensagens em
--     rajada, do mesmo chip, sem um segundo entre elas. É o padrão exato que o
--     antispam do WhatsApp procura, e o próprio texto da tela ("mande um de
--     cada vez") era só um pedido;
--   • Meus contatos → perfil: toda mensagem de seguimento, sem teto e sem
--     espaçamento, quantas vezes quisesse;
--   • "Mandar de novo": reenvio do material sem limite.
--
-- Duas decisões de desenho aqui, e nenhuma é óbvia:
--
-- 1. O INTERVALO SÓ VALE PARA ABORDAGEM (permissão, material, convite ao canal).
--    Não vale para `saida`, `quem_passou`, `quer_ajudar` e `encaminhamento` —
--    essas são RESPOSTAS dentro de uma conversa viva, para alguém que acabou de
--    escrever. Fazer o atendente esperar 90 segundos para responder "foi um
--    apoiador que me passou seu contato" é o que faz ELE parecer robô, que é o
--    oposto do que a trava protege.
--
-- 2. O TETO SÓ CONTA PESSOA NOVA no dia. Seguir a conversa de quem já foi
--    abordado hoje não é uma abordagem a mais; o teto conta com quantas pessoas
--    o número falou, não quantas mensagens mandou.
--
-- Reabrir a MESMA etapa do MESMO contato continua idempotente e continua
-- passando: não há mensagem nova a registrar, e recusar duplo clique com
-- "aguarde o intervalo" seria mentir para o atendente.

/**
 * As etapas em que o sistema procura alguém. As outras são resposta.
 *
 * Irmã de `etapa_por_candidato`, e separada dela de propósito: uma responde
 * "esta mensagem é de um candidato só?", esta responde "esta mensagem é uma
 * abordagem?". Hoje as listas se parecem; elas não são a mesma pergunta.
 */
create or replace function public.etapa_de_abordagem(p_etapa public.etapa_msg)
returns boolean
language sql immutable
as $$ select p_etapa in ('permissao', 'material', 'convite_grupo'); $$;

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
     -- coalesce em todos: a primeira gravação de cada campo é a que vale.
     set aberto_wa_em  = coalesce(interacoes.aberto_wa_em, excluded.aberto_wa_em),
         texto_enviado = coalesce(interacoes.texto_enviado, excluded.texto_enviado),
         variacao_id   = coalesce(interacoes.variacao_id, excluded.variacao_id),
         chip_id       = coalesce(interacoes.chip_id, excluded.chip_id)
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

-- ── O contador da tela usa a MESMA base do servidor ───────────────────────
-- `segundos_espera` passa a olhar só as etapas de abordagem. Sem isto, uma
-- resposta rápida (que a trava deixa passar) reiniciaria a contagem regressiva
-- na tela e o atendente veria "aguarde 90s" sem que o servidor fosse recusar
-- nada — a tela e a trava discordando, que é o defeito que a migration 220200
-- já teve de corrigir uma vez.
create or replace function public.fila_status(p_chip_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_usuario   public.usuarios%rowtype;
  v_chip      public.chips%rowtype;
  v_cfg       public.config%rowtype;
  v_hoje      date := public.hoje_operacional();
  v_hora      int  := public.hora_local();
  v_rampa     record;
  v_enviados  int;
  v_ultimo    timestamptz;
  v_espera    int := 0;
  v_quentes   int;
  v_frios     int;
  v_atual     uuid;
  v_motivo    public.motivo_fila := 'ok';
begin
  if v_uid is null then
    return jsonb_build_object('pode', false, 'motivo', 'usuario_inativo');
  end if;

  select * into v_cfg from public.config where id = 1;
  select * into v_usuario from public.usuarios where id = v_uid;
  select * into v_chip from public.chips where id = p_chip_id;

  -- ⚠️ A posse do chip é conferida ANTES de qualquer conta. A versão anterior
  -- calculava enviados_hoje, dia_rampa e teto_hoje e devolvia tudo no JSON
  -- mesmo quando o motivo era `chip_nao_e_seu` — qualquer atendente enumerava a
  -- produção dos colegas passando o id do chip deles.
  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    -- Devolve o formato inteiro, zerado. A tela espera todos os campos (a
    -- contagem regressiva lê `segundos_espera` direto), e um objeto pela metade
    -- viraria NaN no cronômetro em vez de uma mensagem em português.
    return jsonb_build_object(
      'pode', false, 'motivo', 'chip_nao_e_seu',
      'segundos_espera', 0, 'dia_rampa', 0, 'teto_hoje', 0, 'enviados_hoje', 0,
      'restante_hoje', 0, 'intervalo_seg', 0, 'hora_local', v_hora,
      'hora_inicio', v_cfg.hora_inicio, 'hora_fim', v_cfg.hora_fim,
      'quentes_na_fila', 0, 'frios_na_fila', 0, 'em_atendimento_id', null
    );
  end if;

  select c.id into v_atual
    from public.contatos c
   where c.atendente_id = v_uid
     and c.status = 'em_atendimento'
     and c.claim_expira_em > now()
   order by c.claimed_at
   limit 1;

  -- Mesmo critério do claim: sem isto o contador mente.
  select count(*) filter (where c.origem <> 'lista_fria'),
         count(*) filter (where c.origem = 'lista_fria')
    into v_quentes, v_frios
    from public.contatos c
   where c.status = 'na_fila'
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
     );

  select * into v_rampa from public.rampa_do_chip(p_chip_id);

  select count(distinct i.contato_id)::int into v_enviados
    from public.interacoes i
   where i.chip_id = p_chip_id
     and i.dia_operacional = v_hoje
     and i.aberto_wa_em is not null;

  v_enviados := coalesce(v_enviados, 0);

  select max(i.aberto_wa_em) into v_ultimo
    from public.interacoes i
   where i.chip_id = p_chip_id
     and i.dia_operacional = v_hoje
     and i.aberto_wa_em is not null
     and public.etapa_de_abordagem(i.etapa);

  if v_ultimo is not null then
    v_espera := greatest(0, v_rampa.intervalo_seg - floor(extract(epoch from (now() - v_ultimo)))::int);
  end if;

  if v_usuario.id is null or not v_usuario.ativo then
    v_motivo := 'usuario_inativo';
  elsif v_usuario.termo_aceito_em is null then
    v_motivo := 'termo_nao_aceito';
  elsif v_chip.status in ('pausado', 'morto')
        or (v_chip.pausado_ate is not null and v_chip.pausado_ate > now()) then
    v_motivo := 'chip_indisponivel';
  elsif exists (select 1 from public.dias_bloqueados d where d.data = v_hoje) then
    v_motivo := 'dia_bloqueado';
  elsif v_hora < v_cfg.hora_inicio or v_hora >= v_cfg.hora_fim then
    v_motivo := 'fora_de_horario';
  elsif v_enviados >= v_rampa.teto then
    v_motivo := 'teto_atingido';
  elsif v_espera > 0 then
    v_motivo := 'intervalo';
  elsif v_quentes + v_frios = 0 and v_atual is null then
    v_motivo := 'fila_vazia';
  end if;

  return jsonb_build_object(
    'pode',             v_motivo = 'ok',
    'motivo',           v_motivo,
    'segundos_espera',  v_espera,
    'dia_rampa',        v_rampa.dia_rampa,
    'teto_hoje',        v_rampa.teto,
    'enviados_hoje',    v_enviados,
    'restante_hoje',    greatest(0, v_rampa.teto - v_enviados),
    'intervalo_seg',    v_rampa.intervalo_seg,
    'hora_local',       v_hora,
    'hora_inicio',      v_cfg.hora_inicio,
    'hora_fim',         v_cfg.hora_fim,
    'quentes_na_fila',  coalesce(v_quentes, 0),
    'frios_na_fila',    coalesce(v_frios, 0),
    'em_atendimento_id', v_atual
  );
end;
$$;
