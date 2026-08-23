-- =============================================================================
-- Os contadores da fila passam a respeitar a chapa do atendente
-- =============================================================================
-- fila_status contava TODOS os contatos na fila, inclusive leads de candidatos
-- que aquele atendente não atende. Ele via "1 quente na fila", clicava e recebia
-- "não há mais contatos" — o contador dizia uma coisa e o botão fazia outra.
--
-- Os números agora usam exatamente o mesmo critério do claim.
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
     and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac)
     and (
       c.candidato_origem_id is null
       or exists (
         select 1 from public.atendente_candidatos ac
          where ac.atendente_id = v_uid and ac.candidato_id = c.candidato_origem_id
       )
     );

  select * into v_rampa from public.rampa_do_chip(p_chip_id);

  select count(distinct i.contato_id)::int, max(i.aberto_wa_em)
    into v_enviados, v_ultimo
    from public.interacoes i
   where i.chip_id = p_chip_id
     and i.dia_operacional = v_hoje
     and i.aberto_wa_em is not null;

  v_enviados := coalesce(v_enviados, 0);

  if v_ultimo is not null then
    v_espera := greatest(0, v_rampa.intervalo_seg - floor(extract(epoch from (now() - v_ultimo)))::int);
  end if;

  select * into v_chip from public.chips where id = p_chip_id;

  if v_usuario.id is null or not v_usuario.ativo then
    v_motivo := 'usuario_inativo';
  elsif v_usuario.termo_aceito_em is null then
    v_motivo := 'termo_nao_aceito';
  elsif v_chip.id is null or v_chip.atendente_id <> v_uid then
    v_motivo := 'chip_nao_e_seu';
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
