-- =============================================================================
-- Sem candidato atribuído, não se aborda ninguém
-- =============================================================================
-- O QUE ACONTECEU, em 27/08/2026, com contatos reais:
--
-- `registrar_abertura` congela o consentimento no instante da permissão —
-- copia a chapa do atendente para `contato_candidato`, e é essa cópia que
-- autoriza o material depois. Nada preenche essa cópia mais tarde: é assim de
-- propósito, senão um candidato atribuído hoje alcançaria quem autorizou
-- ontem sem nunca ter ouvido o nome dele.
--
-- Só que a chapa VAZIA passava batido. Quatro atendentes abordaram 11 pessoas
-- antes de ter candidato atribuído. O modelo ativo da permissão tem
-- `{{candidatos}}`, que renderizou vazio, e as mensagens saíram assim:
--
--   "Aqui é Roberta. Tô ajudando  nessa eleição, e um apoiador me passou seu
--    contato. Posso te mandar o material aqui?"
--
-- Onze pessoas autorizaram "o material" sem que ninguém dissesse de quem. E
-- como a cópia nasceu vazia, o material ficou travado para sempre: a tela do
-- atendente dizia "não há candidato liberado para esta pessoa" mesmo depois de
-- o gestor atribuir a chapa.
--
-- Três coisas aqui:
--   1. a permissão passa a ser recusada quando a chapa está vazia;
--   2. a fila recusa ANTES, para o atendente descobrir na tela de espera e não
--      com o contato na mão;
--   3. o gestor ganha a lista de quem está sem chapa, e a ferramenta de
--      reparar os contatos que já ficaram órfãos.

-- ── 1. A recusa na montagem da mensagem ─────────────────────────────────────
-- Recusar aqui, e não em `registrar_abertura`, é o mesmo raciocínio da
-- migration `teto_e_intervalo_no_envio`: se o texto chega a existir na tela, o
-- que separa o envio indevido de acontecer é a disciplina de quem está com
-- pressa. Sem mensagem montada não há o que enviar.
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
  if p_etapa <> 'saida'
     and exists (select 1 from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_bloqueado');
  end if;
  if v_contato.telefone_e164 is null then
    return jsonb_build_object('ok', false, 'motivo', 'dados_apagados');
  end if;

  -- ⚠️ A TRAVA NOVA. Ver o cabeçalho desta migration.
  --
  -- Vale só para a permissão: as outras etapas ou são por candidato (e aí a
  -- trava é `candidato_nao_declarado`, mais apertada), ou são resposta a quem
  -- já está conversando, e travar a saída de alguém que pediu para sair seria
  -- o pior efeito colateral possível.
  if p_etapa = 'permissao'
     and not exists (select 1 from public.chapa_do_atendente(v_uid)) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_chapa');
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

-- ── 2. A fila recusa antes de entregar ──────────────────────────────────────
-- Só muda uma coisa em relação à versão da migration `listas_por_atendente`:
-- a recusa `sem_candidato`, que vem logo depois de `termo_nao_aceito`. As duas
-- são a mesma categoria de problema — configuração faltando, não fila vazia —
-- e mandam o atendente para o mesmo lugar: falar com o gestor.
create or replace function public.fila_status(
  p_chip_id  uuid,
  p_lista_id uuid default null
)
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

  -- ⚠️ A RECUSA NOVA, e ela vem cedo de propósito: sem chapa, nada do que vem
  -- depois importa. Ver o cabeçalho desta migration.
  --
  -- Vale só quando NÃO há contato na mão. Quem já está no meio de uma conversa
  -- termina a conversa: aquela pessoa já foi abordada e merece o fim — inclusive
  -- a saída, que é a única mensagem que ninguém pode ficar sem receber.
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
     and public.etapa_de_abordagem(i.etapa);

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
  elsif v_enviados >= v_rampa.teto then
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

-- ── 3. O gestor enxerga quem está sem chapa ─────────────────────────────────
-- Mesmo desenho de `v_atendentes_sem_lista`, e pelo mesmo motivo: o atendente
-- não tem como saber que o problema é configuração. Ele fica sentado achando
-- que a base acabou.
create or replace view public.v_atendentes_sem_chapa
with (security_invoker = true) as
  select u.id, u.primeiro_nome
    from public.usuarios u
   where u.papel = 'atendente'
     and u.ativo
     and not exists (
       select 1 from public.atendente_candidatos ac
        join public.candidatos c on c.id = ac.candidato_id and c.ativo
       where ac.atendente_id = u.id
     );

-- ── 4. Os contatos que ficaram órfãos ───────────────────────────────────────
-- A marca de que a declaração foi REPARO, e não o congelamento normal da
-- primeira mensagem. Ela existe para a tela do atendente conseguir avisar que
-- aquela pessoa não ouviu o nome do candidato — o que muda o que ele deve
-- escrever antes de mandar o material.
alter table public.contato_candidato
  add column if not exists declarado_em_reparo boolean not null default false;

comment on column public.contato_candidato.declarado_em_reparo is
  'true quando a linha não nasceu da primeira mensagem, e sim do reparo do '
  'gestor. A pessoa NÃO ouviu o nome deste candidato na permissão.';

/**
 * Declara a chapa atual do atendente para os contatos dele que ficaram sem
 * nenhum candidato declarado.
 *
 * ⚠️ SÓ O GESTOR, e de propósito: isto contorna o congelamento do
 * consentimento, que é a trava mais séria do sistema. Quem responde pela
 * campanha é quem pode decidir correr esse risco — não o atendente que quer
 * destravar o próprio turno.
 *
 * Alcança apenas contato que:
 *   • é daquele atendente;
 *   • teve a primeira mensagem enviada de verdade;
 *   • está com ZERO candidatos declarados (o buraco de 27/08).
 *
 * Não toca em quem já tem declaração: o congelamento continua valendo para
 * todo mundo que foi abordado com a chapa montada.
 */
create or replace function public.declarar_candidatos_pendentes(p_atendente_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_contatos  int  := 0;
  v_linhas    int  := 0;
  v_chapa     int;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'so_gestor');
  end if;

  select count(*) into v_chapa from public.chapa_do_atendente(p_atendente_id);
  if v_chapa = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'atendente_sem_chapa');
  end if;

  with orfaos as (
    select c.id
      from public.contatos c
     where c.atendente_id = p_atendente_id
       and c.primeiro_contato_em is not null
       and c.anonimizado_em is null
       and not exists (
         select 1 from public.contato_candidato cc where cc.contato_id = c.id
       )
  ),
  gravadas as (
    insert into public.contato_candidato
      (contato_id, candidato_id, atendente_id, declarado_em_reparo)
    select o.id, ch.candidato_id, p_atendente_id, true
      from orfaos o
     cross join public.chapa_do_atendente(p_atendente_id) ch
    on conflict (contato_id, candidato_id) do nothing
    returning contato_id
  )
  select count(*)::int, count(distinct contato_id)::int
    into v_linhas, v_contatos
    from gravadas;

  -- Rastro. Contornar o congelamento do consentimento não pode acontecer em
  -- silêncio: sem isto, ninguém consegue olhar para trás e entender por que
  -- estas pessoas receberam material de um candidato que não foi citado na
  -- primeira mensagem.
  if v_contatos > 0 then
    insert into public.alertas (tipo, atendente_id, detalhe)
    values ('consentimento_reparado', p_atendente_id,
            'O gestor declarou a chapa atual para ' || v_contatos ||
            ' contato(s) que foram abordados antes de o atendente ter candidato ' ||
            'atribuído. Essas pessoas NÃO ouviram o nome do candidato na primeira ' ||
            'mensagem — o atendente precisa se apresentar antes de mandar material.');
  end if;

  return jsonb_build_object('ok', true, 'contatos', v_contatos, 'declaracoes', v_linhas);
end;
$$;

revoke execute on function public.declarar_candidatos_pendentes(uuid) from anon, public;
grant  execute on function public.declarar_candidatos_pendentes(uuid) to authenticated;

/**
 * Quantos contatos de cada atendente estão órfãos — o número que o botão de
 * reparo precisa mostrar ANTES de alguém clicar nele.
 */
create or replace function public.contatos_sem_candidato_declarado()
returns table (atendente_id uuid, primeiro_nome text, contatos int, tem_chapa boolean)
language sql stable security definer set search_path = ''
as $$
  select u.id, u.primeiro_nome, count(c.id)::int,
         exists (select 1 from public.chapa_do_atendente(u.id))
    from public.usuarios u
    join public.contatos c
      on c.atendente_id = u.id
     and c.primeiro_contato_em is not null
     and c.anonimizado_em is null
     and not exists (
       select 1 from public.contato_candidato cc where cc.contato_id = c.id
     )
   where public.is_gestor()
   group by u.id, u.primeiro_nome
   having count(c.id) > 0
   order by count(c.id) desc;
$$;

revoke execute on function public.contatos_sem_candidato_declarado() from anon, public;
grant  execute on function public.contatos_sem_candidato_declarado() to authenticated;

-- ── 5. A tela precisa distinguir declaração normal de reparo ────────────────
-- `drop` antes de `create` porque acrescentar coluna muda o tipo de retorno, e
-- `create or replace` recusa isso.
drop function if exists public.candidatos_do_contato(uuid);

create function public.candidatos_do_contato(p_contato_id uuid)
returns table (
  candidato_id        uuid,
  nome_urna           text,
  cargo               public.cargo_eleitoral,
  numero              text,
  partido_sigla       text,
  ativo               boolean,
  principal           boolean,
  material_enviado_em timestamptz,
  materiais           int,
  canais              int,
  /**
   * A pessoa NÃO ouviu o nome deste candidato na primeira mensagem: a linha
   * veio do reparo do gestor. A tela do atendente usa isto para pedir que ele
   * se apresente antes de mandar o material.
   */
  declarado_em_reparo boolean
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.nome_urna, c.cargo, c.numero, c.partido_sigla, c.ativo,
         coalesce(ac.principal, false),
         cc.material_enviado_em,
         (select count(*)::int from public.materiais m
           where m.candidato_id = c.id and m.ativo),
         (select count(*)::int from public.materiais m
           where m.candidato_id = c.id and m.ativo and m.tipo = 'canal'),
         cc.declarado_em_reparo
    from public.contato_candidato cc
    join public.candidatos c on c.id = cc.candidato_id
    left join public.atendente_candidatos ac
           on ac.candidato_id = c.id and ac.atendente_id = (select auth.uid())
   where cc.contato_id = p_contato_id
     and (
       public.is_gestor()
       or exists (
         select 1 from public.contatos ct
          where ct.id = p_contato_id and ct.atendente_id = (select auth.uid())
       )
     )
   order by coalesce(ac.principal, false) desc,
            public.ordem_do_cargo(c.cargo),
            c.nome_urna;
$$;

revoke execute on function public.candidatos_do_contato(uuid) from anon, public;
grant  execute on function public.candidatos_do_contato(uuid) to authenticated;
