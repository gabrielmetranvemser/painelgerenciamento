-- =============================================================================
-- A fila: claim atômico e travas de servidor
-- =============================================================================
-- Tudo aqui é `security definer` porque o atendente NÃO tem escrita em
-- `contatos` (ver rls.sql). E tudo revalida as travas no servidor: o frontend
-- só reflete o que estas funções responderam. Trava de frontend se burla
-- abrindo o DevTools.

-- ── Auxiliares de fuso ──────────────────────────────────────────────────────

create or replace function public.hoje_operacional()
returns date
language sql stable security definer set search_path = ''
as $$
  select (now() at time zone (select c.timezone from public.config c where c.id = 1))::date;
$$;

create or replace function public.hora_local()
returns int
language sql stable security definer set search_path = ''
as $$
  select extract(hour from (now() at time zone (select c.timezone from public.config c where c.id = 1)))::int;
$$;

-- ── Rampa de aquecimento ────────────────────────────────────────────────────
-- docs/02-CONSTRUCAO-TECNICA.md §7. Chip novo que fala com 30 desconhecidos no
-- primeiro dia morre. O teto sobe conforme o chip acumula dias de trabalho.
--
-- CORREÇÃO: o documento guardava `dia_rampa` como coluna incrementada por cron.
-- Aqui ele é DERIVADO da quantidade de dias operacionais distintos em que o
-- chip realmente abriu conversa. Assim o dia 3 é mesmo o terceiro dia de uso —
-- não avança sozinho num fim de semana parado, e não trava se o cron falhar.
create or replace function public.rampa_do_chip(p_chip_id uuid)
returns table (dia_rampa int, teto int, intervalo_seg int)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoje  date := public.hoje_operacional();
  v_dias  int;
  v_cfg   public.config%rowtype;
begin
  select * into v_cfg from public.config where id = 1;

  select count(distinct i.dia_operacional)::int into v_dias
    from public.interacoes i
   where i.chip_id = p_chip_id
     and i.aberto_wa_em is not null
     and i.dia_operacional < v_hoje;

  dia_rampa := v_dias + 1;

  -- teto e intervalo da rampa
  teto := case
            when dia_rampa <= 1 then 5
            when dia_rampa = 2  then 8
            when dia_rampa = 3  then 12
            when dia_rampa = 4  then 18
            when dia_rampa = 5  then 25
            else 30
          end;
  intervalo_seg := case
                     when dia_rampa <= 2 then 120
                     when dia_rampa <= 4 then 90
                     else 60
                   end;

  -- O gestor pode ser mais restritivo que a rampa, nunca mais permissivo.
  teto := least(teto, v_cfg.teto_diario);
  intervalo_seg := greatest(intervalo_seg, v_cfg.intervalo_seg);

  return next;
end;
$$;

-- ── Situação da fila para um chip ───────────────────────────────────────────
-- Alimenta a tela do atendente: o botão travado, a contagem regressiva e o
-- motivo em português. `pegar_proximo_contato` chama a mesma função, então a
-- tela nunca pode discordar do servidor.
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

  -- contato que já está na mão deste atendente (recarregar a página não pode
  -- fazer o contato atual ser pulado)
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
     and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac);

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

  -- ── as travas, em ordem ───────────────────────────────────────────────────
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

-- ── Pegar o próximo contato ─────────────────────────────────────────────────
-- ⚠️ NUNCA fazer "busca o próximo e depois marca" no frontend: sob concorrência
-- dois atendentes pegam o mesmo contato, ligam para a mesma pessoa, e isso vira
-- denúncia. O `for update skip locked` resolve dentro do Postgres.
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

  -- 1. Já tem contato na mão? Devolve o mesmo. Recarregar a página, perder a
  --    conexão ou trocar de aba não pode consumir um contato novo nem pular
  --    quem já foi abordado.
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

  -- 2. Travas de servidor.
  v_status := public.fila_status(p_chip_id);
  if not (v_status->>'pode')::boolean then
    return jsonb_build_object('ok', false, 'motivo', v_status->>'motivo', 'fila', v_status);
  end if;

  -- 3. Claim atômico.
  select c.id into v_id
    from public.contatos c
   where c.status = 'na_fila'
     and c.telefone_e164 is not null
     and (c.atendente_id is null or c.atendente_id = v_uid)
     and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac)
   order by
     -- retomada do próprio atendente primeiro
     (c.atendente_id = v_uid) desc nulls last,
     -- QUENTE antes de FRIO. Quem se cadastrou sozinho é atendido primeiro:
     -- gera troca real de mensagem e deixa o número mais resistente antes de
     -- encostar na lista fria (docs/01-VISAO-GERAL.md §4).
     (c.origem = 'lista_fria'),
     c.criado_em
   for update skip locked
   limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'fila_vazia', 'fila', v_status);
  end if;

  update public.contatos
     set status          = 'em_atendimento',
         atendente_id    = v_uid,
         chip_id         = p_chip_id,
         claimed_at      = now(),
         -- Lease curto de propósito. Contato preso é fila parada; um cron
         -- devolve os vencidos (docs/02-CONSTRUCAO-TECNICA.md §6).
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

-- Serialização do contato para a tela. Função separada para o formato ficar
-- num lugar só.
create or replace function public.contato_json(c public.contatos)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id',            c.id,
    'nome',          c.nome,
    'primeiro_nome', c.primeiro_nome,
    'telefone_e164', c.telefone_e164,
    'origem',        c.origem,
    'status',        c.status,
    'municipio',     (select m.nome from public.municipios m where m.id = c.municipio_id),
    'municipio_id',  c.municipio_id,
    'claim_expira_em', c.claim_expira_em
  );
$$;

-- ── Registrar a abertura da conversa ────────────────────────────────────────
create or replace function public.registrar_abertura(
  p_contato_id uuid,
  p_chip_id    uuid,
  p_etapa      public.etapa_msg,
  p_texto      text default null,
  p_variacao_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_cfg     public.config%rowtype;
  v_hoje    date := public.hoje_operacional();
  v_hora    int  := public.hora_local();
  v_chip    public.chips%rowtype;
  v_contato public.contatos%rowtype;
  v_id      uuid;
  v_ja      boolean;
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
  -- Bloqueado nunca recebe mensagem, nem que já esteja em atendimento: envio
  -- depois do pedido de saída gera multa POR MENSAGEM.
  if exists (select 1 from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_bloqueado');
  end if;

  -- Idempotente pelo unique (contato_id, etapa): duplo clique em "Abrir
  -- conversa" não conta duas vezes no teto do chip.
  insert into public.interacoes
    (contato_id, atendente_id, chip_id, etapa, variacao_id, texto_enviado,
     aberto_wa_em, dia_operacional)
  values
    (p_contato_id, v_uid, p_chip_id, p_etapa, p_variacao_id, p_texto,
     now(), v_hoje)
  on conflict (contato_id, etapa) do update
     set aberto_wa_em = coalesce(interacoes.aberto_wa_em, excluded.aberto_wa_em)
  returning id, (xmax <> 0) into v_id, v_ja;

  update public.contatos
     set primeiro_contato_em = coalesce(primeiro_contato_em, now()),
         chip_id = coalesce(chip_id, p_chip_id)
   where id = p_contato_id;

  return jsonb_build_object(
    'ok', true,
    'ja_registrado', coalesce(v_ja, false),
    'interacao_id', v_id,
    'fila', public.fila_status(p_chip_id)
  );
end;
$$;

-- ── Registrar o resultado ───────────────────────────────────────────────────
create or replace function public.registrar_resultado(
  p_contato_id     uuid,
  p_resultado      public.status_contato,
  p_municipio_id   smallint default null,
  p_encaminhamento text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_contato public.contatos%rowtype;
begin
  if p_resultado not in ('autorizou','pediu_saida','invalido','quer_ajudar','encaminhado') then
    return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
  end if;

  select * into v_contato from public.contatos where id = p_contato_id for update;

  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;

  -- Anti-fraude: só há resultado se houve conversa. Sem isto o atendente
  -- percorreria a fila marcando "sem resposta" sem falar com ninguém, e o
  -- relatório do gestor mediria trabalho que não aconteceu.
  if not exists (
    select 1 from public.interacoes i
     where i.contato_id = p_contato_id and i.aberto_wa_em is not null
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_aberta');
  end if;

  update public.contatos
     set status          = p_resultado,
         resultado_em    = now(),
         claim_expira_em = null,
         municipio_id    = coalesce(p_municipio_id, municipio_id),
         encaminhamento  = coalesce(p_encaminhamento, encaminhamento)
   where id = p_contato_id;

  update public.interacoes
     set resultado = p_resultado, resultado_em = now()
   where contato_id = p_contato_id
     and aberto_wa_em is not null
     and resultado is null;

  -- Pedido de saída vira bloqueio NO MESMO COMMIT. Não pode existir janela em
  -- que o contato já foi marcado mas ainda não está bloqueado.
  if p_resultado = 'pediu_saida' then
    insert into public.bloqueios (telefone_hmac, hmac_versao, motivo, origem, contato_id, apagar_em)
    values (v_contato.telefone_hmac, v_contato.hmac_versao, 'Pediu saída no atendimento',
            'pediu_saida', p_contato_id, now() + interval '48 hours')
    on conflict (telefone_hmac) do nothing;
  end if;

  return jsonb_build_object('ok', true, 'status', p_resultado);
end;
$$;

-- ── Botão "Meu WhatsApp está estranho" ──────────────────────────────────────
-- Vale mais que qualquer métrica automática: o atendente sente a queda antes de
-- o sistema medir (docs/03-OPERACAO.md §5).
create or replace function public.sinalizar_chip(p_chip_id uuid, p_detalhe text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid  uuid := (select auth.uid());
  v_chip public.chips%rowtype;
begin
  select * into v_chip from public.chips where id = p_chip_id;
  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;

  update public.chips set status = 'amarelo' where id = p_chip_id and status not in ('morto','pausado');

  insert into public.alertas (tipo, chip_id, atendente_id, detalhe)
  values ('whatsapp_estranho', p_chip_id, v_uid, p_detalhe);

  return jsonb_build_object('ok', true);
end;
$$;

-- ── Gestor: matar um chip ───────────────────────────────────────────────────
-- Quando um chip cai, as conversas dele morrem junto e não há recuperação.
-- Os contatos que estavam com ele viram `perdido` e NÃO voltam para a fila:
-- reabordar quem já foi abordado por um número morto é insistência
-- (docs/03-OPERACAO.md §2.5).
create or replace function public.marcar_chip_morto(p_chip_id uuid, p_detalhe text default null)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_perdidos int;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'somente_gestor');
  end if;

  update public.chips set status = 'morto' where id = p_chip_id;

  with mortos as (
    update public.contatos
       set status = 'perdido', claim_expira_em = null, resultado_em = now()
     where chip_id = p_chip_id and status = 'em_atendimento'
     returning 1
  ) select count(*)::int into v_perdidos from mortos;

  insert into public.alertas (tipo, chip_id, detalhe)
  values ('chip_morto', p_chip_id, coalesce(p_detalhe, 'Chip marcado como morto pelo gestor'));

  return jsonb_build_object('ok', true, 'contatos_perdidos', v_perdidos);
end;
$$;

-- ── Manutenção (chamada pelo cron) ──────────────────────────────────────────
create or replace function public.expirar_leases()
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  with devolvidos as (
    update public.contatos
       set status = 'na_fila',
           atendente_id = null,   -- volta para o bolo geral: quem pegou pode
           chip_id = null,        -- ter ido embora, e fila parada é prejuízo
           claimed_at = null,
           claim_expira_em = null
     where status = 'em_atendimento'
       and claim_expira_em is not null
       and claim_expira_em < now()
       and not exists (select 1 from public.interacoes i
                       where i.contato_id = contatos.id and i.aberto_wa_em is not null)
     returning 1
  ) select count(*)::int into v_n from devolvidos;
  return v_n;
end;
$$;

-- ── Permissões ──────────────────────────────────────────────────────────────
revoke execute on function public.pegar_proximo_contato(uuid) from anon, public;
revoke execute on function public.registrar_abertura(uuid, uuid, public.etapa_msg, text, uuid) from anon, public;
revoke execute on function public.registrar_resultado(uuid, public.status_contato, smallint, text) from anon, public;
revoke execute on function public.sinalizar_chip(uuid, text) from anon, public;
revoke execute on function public.marcar_chip_morto(uuid, text) from anon, public;
revoke execute on function public.fila_status(uuid) from anon, public;
revoke execute on function public.expirar_leases() from anon, public, authenticated;

grant execute on function public.pegar_proximo_contato(uuid) to authenticated;
grant execute on function public.registrar_abertura(uuid, uuid, public.etapa_msg, text, uuid) to authenticated;
grant execute on function public.registrar_resultado(uuid, public.status_contato, smallint, text) to authenticated;
grant execute on function public.sinalizar_chip(uuid, text) to authenticated;
grant execute on function public.marcar_chip_morto(uuid, text) to authenticated;
grant execute on function public.fila_status(uuid) to authenticated;
