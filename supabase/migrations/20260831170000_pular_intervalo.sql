-- =============================================================================
-- "Pular intervalo": o atendente pode, sabendo o que está fazendo
-- =============================================================================
-- Mesma decisão do teto, um passo adiante: o painel APONTA e quem está com o
-- número na mão DECIDE. A diferença é que aqui o risco é maior — o intervalo
-- entre abordagens é o espaçamento que o antispam do WhatsApp mais olha, e é a
-- trava que existe para o número do atendente não cair.
--
-- Por isso ele não vira um interruptor de configuração: vira um ato, um de cada
-- vez, com dois cliques e um aviso que fica mais duro a cada repetição.
--
-- ── UM PULO LIBERA UMA CONVERSA, E SÓ ──────────────────────────────────────
--
-- É por isso que existe tabela e não uma coluna `pular_ate` em `chips`. Uma
-- janela de tempo liberaria quantas conversas coubessem nela — que é exatamente
-- o disparo que o intervalo existe para impedir. Aqui cada pulo é uma linha,
-- consumida pela PRIMEIRA abordagem que sair depois dele. Querer pular de novo
-- é clicar de novo, e ler o aviso de novo.
--
-- ── A CONTAGEM É DO DIA, POR NÚMERO ────────────────────────────────────────
--
-- O aviso escala com quantas vezes aquele NÚMERO já pulou hoje, não com quantas
-- o atendente pulou na vida. Quem cai é o chip, e o dia é o horizonte em que a
-- conta faz sentido — amanhã o número acorda inteiro.
--
-- ── O GESTOR PRECISA SABER ─────────────────────────────────────────────────
--
-- Do TERCEIRO pulo do dia em diante entra alerta. Não do primeiro: um pulo é
-- uma pessoa que ligou de volta na hora errada, e encher a Visão geral com isso
-- faria o gestor parar de ler os alertas — que é como se perde o aviso que
-- importa. Três vezes no mesmo dia já é padrão, não acidente.

create table if not exists public.intervalos_pulados (
  id              bigint generated always as identity primary key,
  chip_id         uuid not null references public.chips(id) on delete cascade,
  atendente_id    uuid not null references public.usuarios(id) on delete cascade,
  dia_operacional date not null,
  criado_em       timestamptz not null default now(),
  -- Preenchido pela abordagem que gastou este pulo. Nulo = ainda vale.
  consumido_em    timestamptz,
  interacao_id    uuid references public.interacoes(id) on delete set null
);

create index if not exists intervalos_pulados_vivos_idx
  on public.intervalos_pulados (chip_id) where consumido_em is null;
create index if not exists intervalos_pulados_dia_idx
  on public.intervalos_pulados (chip_id, dia_operacional);

alter table public.intervalos_pulados enable row level security;

-- Leitura pelo próprio atendente e pelo gestor; escrita só pelas RPC abaixo.
drop policy if exists intervalos_pulados_leitura on public.intervalos_pulados;
create policy intervalos_pulados_leitura on public.intervalos_pulados
  for select to authenticated
  using (atendente_id = (select auth.uid()) or public.is_gestor());

comment on table public.intervalos_pulados is
  'Cada linha é UM pulo de intervalo, consumido pela primeira abordagem seguinte. '
  'Ver a migration pular_intervalo.';

-- ── Há um pulo esperando para ser usado neste chip? ─────────────────────────
create or replace function public.tem_pulo_de_intervalo(p_chip_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.intervalos_pulados p
     where p.chip_id = p_chip_id
       and p.consumido_em is null
       and p.dia_operacional = public.hoje_operacional()
  );
$$;

-- ── Pular ───────────────────────────────────────────────────────────────────
create or replace function public.pular_intervalo(p_chip_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid   uuid := (select auth.uid());
  v_chip  public.chips%rowtype;
  v_cfg   public.config%rowtype;
  v_hoje  date := public.hoje_operacional();
  v_antes int;
begin
  select * into v_cfg  from public.config where id = 1;
  select * into v_chip from public.chips  where id = p_chip_id;

  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;

  -- ⚠️ Pular o intervalo NÃO pula mais nada. As travas abaixo são de outra
  -- natureza — número morto, dia da eleição, madrugada — e nenhuma delas é
  -- "risco que o atendente assume": são impedimentos.
  if v_chip.status in ('pausado', 'morto')
     or (v_chip.pausado_ate is not null and v_chip.pausado_ate > now()) then
    return jsonb_build_object('ok', false, 'motivo', 'chip_indisponivel');
  end if;
  if exists (select 1 from public.dias_bloqueados d where d.data = v_hoje) then
    return jsonb_build_object('ok', false, 'motivo', 'dia_bloqueado');
  end if;
  if public.hora_local() < v_cfg.hora_inicio or public.hora_local() >= v_cfg.hora_fim then
    return jsonb_build_object('ok', false, 'motivo', 'fora_de_horario');
  end if;

  -- Já tem um pulo sem uso: clicar de novo não acumula dois.
  if public.tem_pulo_de_intervalo(p_chip_id) then
    return jsonb_build_object('ok', true, 'ja_tinha', true,
      'pulos_hoje', (select count(*)::int from public.intervalos_pulados p
                      where p.chip_id = p_chip_id and p.dia_operacional = v_hoje));
  end if;

  select count(*)::int into v_antes
    from public.intervalos_pulados p
   where p.chip_id = p_chip_id and p.dia_operacional = v_hoje;

  insert into public.intervalos_pulados (chip_id, atendente_id, dia_operacional)
  values (p_chip_id, v_uid, v_hoje);

  -- Do terceiro em diante o gestor fica sabendo. Ver o cabeçalho.
  if v_antes + 1 >= 3 then
    insert into public.alertas (tipo, chip_id, atendente_id, detalhe)
    values ('intervalo_pulado', p_chip_id, v_uid,
            'Pulou o intervalo ' || (v_antes + 1) || ' vezes hoje neste número.');
  end if;

  return jsonb_build_object('ok', true, 'ja_tinha', false, 'pulos_hoje', v_antes + 1);
end;
$$;

revoke execute on function public.pular_intervalo(uuid) from anon, public;
grant  execute on function public.pular_intervalo(uuid) to authenticated;
revoke execute on function public.tem_pulo_de_intervalo(uuid) from anon, public;

-- ── A fila deixa passar quando há um pulo guardado ──────────────────────────
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
    'intervalos_pulados_hoje', 0, 'pulo_guardado', false,
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
  -- ⚠️ Um pulo guardado vale por UMA abordagem, e é consumido por ela em
  -- `registrar_abertura`. Enquanto ele existe, a fila deixa passar.
  elsif v_espera > 0 and not public.tem_pulo_de_intervalo(p_chip_id) then
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
    -- Quantas vezes ESTE NÚMERO já pulou o intervalo hoje. É com isto que a
    -- tela endurece o aviso a cada repetição.
    'intervalos_pulados_hoje', (
      select count(*)::int from public.intervalos_pulados p
       where p.chip_id = p_chip_id and p.dia_operacional = v_hoje
    ),
    'pulo_guardado',    public.tem_pulo_de_intervalo(p_chip_id),
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

-- ── E a abordagem CONSOME o pulo ────────────────────────────────────────────
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
  v_pulo       bigint;
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
          -- ⚠️ O PULO É CONSUMIDO AQUI, e é aqui que ele tem de ser consumido:
          -- este é o instante em que a mensagem realmente sai. Gastar o pulo lá
          -- no clique de "Pular intervalo" deixaria o atendente sem ele se
          -- desistisse no meio — e gastar depois deixaria a porta aberta para
          -- várias abordagens com um pulo só, que é o disparo que o intervalo
          -- existe para impedir.
          update public.intervalos_pulados
             set consumido_em = now()
           where id = (
             select p.id from public.intervalos_pulados p
              where p.chip_id = p_chip_id
                and p.consumido_em is null
                and p.dia_operacional = v_hoje
              order by p.criado_em
              limit 1
              for update skip locked
           )
          returning id into v_pulo;

          if v_pulo is null then
            return jsonb_build_object(
              'ok', false, 'motivo', 'intervalo', 'segundos_espera', v_espera
            );
          end if;
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

  -- Fecha o rastro: qual conversa aquele pulo liberou.
  if v_pulo is not null then
    update public.intervalos_pulados set interacao_id = v_id where id = v_pulo;
  end if;

  return jsonb_build_object(
    'ok', true,
    'ja_registrado', v_antes is not null,
    'interacao_id', v_id,
    'candidatos_declarados', v_declarados,
    'fila', public.fila_status(p_chip_id)
  );
end;
$function$;
