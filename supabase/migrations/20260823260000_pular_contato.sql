-- =============================================================================
-- "Buscar outro contato": uma saída para o atendente que travou num contato
-- =============================================================================
-- A fila devolve o contato que está na mão do atendente — é o que impede
-- recarregar a página de pular alguém. Só que sem uma forma de soltar, o
-- atendente que abriu um contato e não vai falar com ele agora fica preso: pede
-- o próximo e recebe o mesmo, para sempre.
--
-- São dois casos, e eles NÃO são a mesma coisa:
--
--   nada foi enviado  → o contato volta para a fila, para outra pessoa pegar
--   já mandei a 1ª msg → a conversa está viva; ela vira "aguardando resposta"
--                        e o cron de 72h fecha. Devolver para a fila faria
--                        outro atendente abordar quem já foi abordado.

-- Um contato devolvido é o mais antigo da fila quente — voltaria na hora
-- seguinte para a mesma pessoa que acabou de pular. O adiamento tira ele de
-- circulação por um tempo, sem tirar da fila.
alter table public.contatos
  add column if not exists adiado_ate timestamptz;

create index if not exists contatos_adiado_idx on public.contatos (adiado_ate)
  where adiado_ate is not null;

create or replace function public.pular_contato(p_contato_id uuid, p_chip_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_contato  public.contatos%rowtype;
  v_falou    boolean;
begin
  select * into v_contato from public.contatos where id = p_contato_id;
  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  if v_contato.status <> 'em_atendimento' then
    return jsonb_build_object('ok', false, 'motivo', 'contato_ja_encerrado');
  end if;

  select exists (
    select 1 from public.interacoes i
     where i.contato_id = p_contato_id and i.aberto_wa_em is not null
  ) into v_falou;

  if v_falou then
    -- Conversa viva: solta só a reserva. Continua em "Meus contatos" como
    -- aguardando resposta, e o cron de 72h fecha se não vier nada.
    update public.contatos
       set claimed_at = null, claim_expira_em = null
     where id = p_contato_id;
    return jsonb_build_object('ok', true, 'destino', 'aguardando_resposta');
  end if;

  update public.contatos
     set status = 'na_fila', atendente_id = null, chip_id = null,
         claimed_at = null, claim_expira_em = null,
         adiado_ate = now() + interval '2 hours'
   where id = p_contato_id;

  return jsonb_build_object(
    'ok', true, 'destino', 'devolvido_a_fila',
    'fila', public.fila_status(p_chip_id)
  );
end;
$$;

revoke execute on function public.pular_contato(uuid, uuid) from anon, public;
grant  execute on function public.pular_contato(uuid, uuid) to authenticated;

-- ── A fila respeita o adiamento ───────────────────────────────────────────
create or replace function public.pegar_proximo_contato(p_chip_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_cfg     public.config%rowtype;
  v_status  jsonb;
  v_contato public.contatos%rowtype;
  v_id      uuid;
begin
  select * into v_cfg from public.config where id = 1;

  select * into v_contato
    from public.contatos c
   where c.atendente_id = v_uid
     and c.status = 'em_atendimento'
     and c.claim_expira_em > now()
   order by c.claimed_at
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', true, 'retomada', true,
      'contato', public.contato_json(v_contato),
      'fila', public.fila_status(p_chip_id)
    );
  end if;

  v_status := public.fila_status(p_chip_id);
  if not (v_status->>'pode')::boolean then
    return jsonb_build_object('ok', false, 'motivo', v_status->>'motivo', 'fila', v_status);
  end if;

  select c.id into v_id
    from public.contatos c
   where c.status = 'na_fila'
     and c.telefone_e164 is not null
     and (c.atendente_id is null or c.atendente_id = v_uid)
     -- Pulado há pouco: fica fora de circulação até o prazo passar.
     and (c.adiado_ate is null or c.adiado_ate <= now())
     and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac)
     and (
       c.candidato_origem_id is null
       or exists (
         select 1 from public.atendente_candidatos ac
          where ac.atendente_id = v_uid and ac.candidato_id = c.candidato_origem_id
       )
     )
   order by
     (c.atendente_id = v_uid) desc nulls last,
     (c.origem = 'lista_fria'),
     c.criado_em
   for update skip locked
   limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'fila_vazia', 'fila', v_status);
  end if;

  update public.contatos
     set status='em_atendimento', atendente_id=v_uid, chip_id=p_chip_id,
         claimed_at=now(), adiado_ate = null,
         claim_expira_em = now() + make_interval(mins => v_cfg.lease_minutos)
   where id = v_id
   returning * into v_contato;

  return jsonb_build_object(
    'ok', true, 'retomada', false,
    'contato', public.contato_json(v_contato),
    'fila', public.fila_status(p_chip_id)
  );
end;
$$;

-- ── E os contadores usam o MESMO critério ─────────────────────────────────
-- Sem isto o painel diz "1 quente na fila", o atendente clica e recebe "não há
-- mais contatos" — foi exatamente esse defeito que a migration 220200 corrigiu.
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
