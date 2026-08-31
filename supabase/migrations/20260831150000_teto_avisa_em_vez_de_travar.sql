-- =============================================================================
-- O teto diário passa a AVISAR em vez de travar — e quem decide é o gestor
-- =============================================================================
-- Pedido de quem opera, em 31/08, com as palavras dele:
--
--     "Eu gostaria MUITO que o limite de mensagem diária não fosse travado
--      (mesmo aquecendo). Mas que viesse um aviso que é bom parar. Porque dessa
--      forma fica por conta e risco do usuário."
--
-- É a mesma decisão que as regras de texto já tomaram em 27/08: o painel APONTA
-- e quem responde pela campanha DECIDE. Regra que tranca a tela não protege o
-- número — ela só transfere o problema para o gestor, que fica sem caminho e
-- sem explicação no meio de um turno.
--
-- ⚠️ O QUE **NÃO** VIRA AVISO, E NÃO PODE VIRAR
--
-- O teto é risco de OPERAÇÃO: no pior caso o WhatsApp derruba um número, e a
-- campanha troca pelo reserva. Custa dinheiro e um dia de trabalho. As travas
-- abaixo são de outra natureza, e continuam recusando:
--
--   `contato_bloqueado`  mensagem depois do pedido de saída é multa POR
--                        MENSAGEM, e por mensagem enviada, não por pessoa
--   `dia_bloqueado`      falar com eleitor no dia da eleição é regra eleitoral
--   `termo_nao_aceito`   sem o aceite datado não há defesa se houver denúncia
--   `sem_candidato`      a primeira mensagem sairia sem dizer de quem é o
--                        material, e quem respondesse autorizaria no escuro
--   `fora_de_horario`    o gestor já escolhe a janela; abrir a madrugada é
--                        mexer no campo dele, não no teto
--   `intervalo`          continua travando, e de propósito: é o espaçamento
--                        entre abordagens, o padrão que o antispam mais olha.
--                        Se também precisar virar aviso, é uma linha — mas é
--                        outra decisão, e ela não foi pedida.
--
-- O interruptor é do gestor e reversível a qualquer momento. Entra DESLIGADO
-- (avisando), que é o que foi pedido.

alter table public.config
  add column if not exists teto_bloqueia boolean not null default false;

comment on column public.config.teto_bloqueia is
  'true = o teto diário RECUSA a conversa. false (padrão) = o teto vira aviso na '
  'tela do atendente e a decisão de continuar é dele. Ver a migration '
  'teto_avisa_em_vez_de_travar.';

-- ── A fila para de recusar por teto quando ele é só aviso ───────────────────
create or replace function public.fila_status(p_chip_id uuid, p_lista_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_tem_lista boolean;
  v_motivo    public.motivo_fila := 'ok';
  v_vazio     jsonb;
begin
  select * into v_cfg from public.config where id = 1;

  v_vazio := jsonb_build_object(
    'segundos_espera', 0, 'dia_rampa', 0, 'teto_hoje', 0, 'enviados_hoje', 0,
    'restante_hoje', 0, 'intervalo_seg', 0, 'hora_local', v_hora,
    'hora_inicio', v_cfg.hora_inicio, 'hora_fim', v_cfg.hora_fim,
    'quentes_na_fila', 0, 'frios_na_fila', 0, 'em_atendimento_id', null,
    'em_rampa', false, 'teto_gestor', v_cfg.teto_diario,
    'teto_bloqueia', v_cfg.teto_bloqueia, 'teto_estourado', false,
    'pode', false
  );

  if v_uid is null then
    return v_vazio || jsonb_build_object('motivo', 'usuario_inativo');
  end if;

  select * into v_usuario from public.usuarios where id = v_uid;
  select * into v_chip    from public.chips    where id = p_chip_id;

  if v_usuario.id is null or not v_usuario.ativo then
    return v_vazio || jsonb_build_object('motivo', 'usuario_inativo');
  end if;
  if v_usuario.termo_aceito_em is null then
    return v_vazio || jsonb_build_object('motivo', 'termo_nao_aceito');
  end if;

  -- Sem chapa, nada do que vem depois importa. Vale só quando NÃO há contato na
  -- mão: quem já está no meio de uma conversa termina a conversa.
  if not exists (select 1 from public.chapa_do_atendente(v_uid))
     and not exists (
       select 1 from public.contatos c
        where c.atendente_id = v_uid
          and c.status = 'em_atendimento'
          and c.claim_expira_em > now()
     ) then
    return v_vazio || jsonb_build_object('motivo', 'sem_candidato');
  end if;

  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return v_vazio || jsonb_build_object('motivo', 'chip_nao_e_seu');
  end if;

  if p_lista_id is not null and not exists (
    select 1 from public.atendente_listas al
     join public.listas l on l.id = al.lista_id
    where al.atendente_id = v_uid and al.lista_id = p_lista_id and l.ativa
  ) then
    return v_vazio || jsonb_build_object('motivo', 'lista_nao_e_sua');
  end if;

  select c.id into v_atual
    from public.contatos c
   where c.atendente_id = v_uid
     and c.status = 'em_atendimento'
     and c.claim_expira_em > now()
   order by c.claimed_at
   limit 1;

  select exists (
    select 1 from public.atendente_listas al
     join public.listas l on l.id = al.lista_id
    where al.atendente_id = v_uid and l.ativa
  ) into v_tem_lista;

  select count(*) filter (where c.origem <> 'lista_fria'),
         count(*) filter (where c.origem = 'lista_fria')
    into v_quentes, v_frios
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
     and (p_lista_id is null or c.lista_id = p_lista_id);

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
     and public.interacao_de_abordagem(i.etapa, i.modelo_livre_id);

  if v_ultimo is not null then
    v_espera := greatest(0, v_rampa.intervalo_seg - floor(extract(epoch from (now() - v_ultimo)))::int);
  end if;

  if v_chip.status in ('pausado', 'morto')
     or (v_chip.pausado_ate is not null and v_chip.pausado_ate > now()) then
    v_motivo := 'chip_indisponivel';
  elsif exists (select 1 from public.dias_bloqueados d where d.data = v_hoje) then
    v_motivo := 'dia_bloqueado';
  elsif v_hora < v_cfg.hora_inicio or v_hora >= v_cfg.hora_fim then
    v_motivo := 'fora_de_horario';
  -- ⚠️ Só recusa se o gestor mandou recusar. Ver o cabeçalho desta migration.
  elsif v_cfg.teto_bloqueia and v_enviados >= v_rampa.teto then
    v_motivo := 'teto_atingido';
  elsif v_espera > 0 then
    v_motivo := 'intervalo';
  elsif v_quentes + v_frios = 0 and v_atual is null then
    v_motivo := case when v_tem_lista then 'fila_vazia' else 'sem_lista' end;
  end if;

  return jsonb_build_object(
    'pode',             v_motivo = 'ok',
    'motivo',           v_motivo,
    'segundos_espera',  v_espera,
    'dia_rampa',        v_rampa.dia_rampa,
    'teto_hoje',        v_rampa.teto,
    -- De onde o teto de hoje veio. Sem isto a tela não consegue distinguir
    -- "o gestor configurou pouco" de "o número ainda está aquecendo".
    'em_rampa',         v_rampa.em_rampa,
    'teto_gestor',      v_cfg.teto_diario,
    'teto_bloqueia',    v_cfg.teto_bloqueia,
    -- O aviso da tela sai daqui: passou do teto e continua podendo trabalhar.
    'teto_estourado',   v_enviados >= v_rampa.teto,
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
$function$;

revoke execute on function public.fila_status(uuid, uuid) from anon, public;
grant  execute on function public.fila_status(uuid, uuid) to authenticated;

-- ── E a abertura da conversa também ─────────────────────────────────────────
create or replace function public.registrar_abertura(p_contato_id uuid, p_chip_id uuid, p_etapa etapa_msg, p_texto text DEFAULT NULL::text, p_variacao_id uuid DEFAULT NULL::uuid, p_candidato_id uuid DEFAULT NULL::uuid, p_modelo_livre_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     and i.candidato_id is not distinct from p_candidato_id
     -- Duas mensagens livres diferentes para a mesma pessoa são DUAS aberturas.
     and i.modelo_livre_id is not distinct from p_modelo_livre_id;

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

    -- ⚠️ O TETO SÓ RECUSA SE O GESTOR MANDOU RECUSAR.
    --
    -- Ver o cabeçalho de `teto_avisa_em_vez_de_travar`. Com
    -- `config.teto_bloqueia = false` ele vira aviso: a tela mostra que passou,
    -- e quem decide continuar é quem está com o número na mão.
    if v_cfg.teto_bloqueia and not v_ja_conta
       and coalesce(v_enviados, 0) >= v_rampa.teto then
      return jsonb_build_object(
        'ok', false, 'motivo', 'teto_atingido',
        'enviados_hoje', coalesce(v_enviados, 0), 'teto_hoje', v_rampa.teto
      );
    end if;

    if public.interacao_de_abordagem(p_etapa, p_modelo_livre_id) then
      select max(i.aberto_wa_em) into v_ultimo
        from public.interacoes i
       where i.chip_id = p_chip_id
         and i.dia_operacional = v_hoje
         and i.aberto_wa_em is not null
         and public.interacao_de_abordagem(i.etapa, i.modelo_livre_id);

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
    (contato_id, atendente_id, chip_id, etapa, candidato_id, modelo_livre_id,
     variacao_id, texto_enviado, aberto_wa_em, dia_operacional)
  values
    (p_contato_id, v_uid, p_chip_id, p_etapa, p_candidato_id, p_modelo_livre_id,
     p_variacao_id, p_texto, now(), v_hoje)
  on conflict (contato_id, etapa, candidato_id, modelo_livre_id) do update
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
$function$;
