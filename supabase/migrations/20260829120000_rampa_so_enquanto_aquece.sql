-- =============================================================================
-- A rampa vale enquanto o número está AQUECENDO, e não para sempre
-- =============================================================================
-- ⚠️ Este é o defeito que travou a Laura em 8 conversas por dia com o gestor
--    tendo configurado 30 — e sem nada na tela dizer de onde vinha o 8.
--
-- `rampa_do_chip` derivava o dia da rampa da quantidade de dias operacionais em
-- que o chip abriu conversa, e aplicava a tabela de aquecimento SEMPRE. Como o
-- dia 2 dá teto 8, e o gestor "pode ser mais restritivo, nunca mais permissivo",
-- o 30 que ele digitou em Configuração virava `least(8, 30)` = 8. Ele mexia no
-- campo, salvava, e não acontecia nada — três dias seguidos.
--
-- Pior: o número da Laura estava marcado como `ativo` havia dias. O enum
-- `status_chip` já documenta `aquecendo` como "ainda em rampa", e o gestor já
-- tem o botão "Marcar ativo" na tela de Números. Só que nada disso era LIDO por
-- `rampa_do_chip` — a rampa se decidia sozinha, olhando o histórico, e o gestor
-- não tinha como dizer "este número é meu há oito anos, ele não precisa
-- aquecer".
--
-- Agora tem. A regra passa a ser a que o enum sempre prometeu:
--
--   status = 'aquecendo'  → a tabela de rampa manda, e o gestor só pode apertar
--   qualquer outro status → o limite é o que o gestor configurou, e ponto
--
-- A proteção continua de pé: todo chip nasce `aquecendo` (ver `criarChip`), e
-- sair da rampa é um ato explícito do gestor num botão que diz o que faz. O que
-- deixou de existir é a rampa invisível, que ninguém podia desligar.
--
-- `em_rampa` entra no retorno para a tela poder EXPLICAR o teto de hoje em vez
-- de só mostrá-lo. Quem lê "Você já fez todas as conversas de hoje" com o
-- gestor tendo prometido 30 conclui que o painel está quebrado — e, até esta
-- migration, estava.

-- Muda o tipo de retorno, então precisa cair antes. Nenhuma view depende dela;
-- só `fila_status` e `registrar_abertura`, e as duas leem com `record`.
drop function if exists public.rampa_do_chip(uuid);

create function public.rampa_do_chip(p_chip_id uuid)
returns table (dia_rampa int, teto int, intervalo_seg int, em_rampa boolean)
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_hoje   date := public.hoje_operacional();
  v_dias   int;
  v_cfg    public.config%rowtype;
  v_status public.status_chip;
begin
  select * into v_cfg from public.config where id = 1;
  select c.status into v_status from public.chips c where c.id = p_chip_id;

  -- Continua DERIVADO, e não coluna incrementada por cron: o dia 3 é mesmo o
  -- terceiro dia de uso do número, não avança sozinho num fim de semana parado
  -- e não trava se o cron falhar.
  select count(distinct i.dia_operacional)::int into v_dias
    from public.interacoes i
   where i.chip_id = p_chip_id
     and i.aberto_wa_em is not null
     and i.dia_operacional < v_hoje;

  dia_rampa := coalesce(v_dias, 0) + 1;

  -- Chip inexistente cai aqui como fora de rampa; quem chama já recusa antes
  -- por `chip_nao_e_seu`.
  em_rampa := v_status is not distinct from 'aquecendo';

  if not em_rampa then
    teto          := v_cfg.teto_diario;
    intervalo_seg := v_cfg.intervalo_seg;
    return next;
    return;
  end if;

  -- docs/02-CONSTRUCAO-TECNICA.md §7. Chip novo que fala com 30 desconhecidos
  -- no primeiro dia morre.
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

  -- Dentro da rampa, o gestor continua podendo ser mais restritivo que ela.
  teto          := least(teto, v_cfg.teto_diario);
  intervalo_seg := greatest(intervalo_seg, v_cfg.intervalo_seg);

  return next;
end;
$$;

revoke execute on function public.rampa_do_chip(uuid) from anon, public;

-- ── `fila_status` passa a dizer de ONDE vem o teto ──────────────────────────
-- Mesma função de antes, com três campos a mais no retorno: `em_rampa`,
-- `teto_gestor` e `dia_rampa` (que já existia). A tela usa os três para
-- escrever "o limite de hoje é 8 porque o número está aquecendo (dia 2), e não
-- porque alguém configurou 8".
create or replace function public.fila_status(p_chip_id uuid, p_lista_id uuid default null)
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
    'em_rampa', false, 'teto_gestor', v_cfg.teto_diario,
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
    -- De onde o teto de hoje veio. Sem isto a tela não consegue distinguir
    -- "o gestor configurou pouco" de "o número ainda está aquecendo".
    'em_rampa',         v_rampa.em_rampa,
    'teto_gestor',      v_cfg.teto_diario,
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

revoke execute on function public.fila_status(uuid, uuid) from anon, public;
grant  execute on function public.fila_status(uuid, uuid) to authenticated;

-- ── O gestor precisa ver o teto de hoje número por número ───────────────────
-- Hoje ele configura 30 e não tem onde conferir que a Laura está com 8. A tela
-- de Números passa a mostrar, e sai desta função para não repetir a tabela de
-- rampa em JavaScript — o dia em que as duas divergirem, quem estará certo é o
-- banco, porque é ele que recusa.
create or replace function public.teto_dos_chips()
returns table (chip_id uuid, dia_rampa int, teto int, intervalo_seg int, em_rampa boolean)
language sql stable security definer set search_path = ''
as $$
  select c.id, r.dia_rampa, r.teto, r.intervalo_seg, r.em_rampa
    from public.chips c
   cross join lateral public.rampa_do_chip(c.id) r
   where public.is_gestor();
$$;

revoke execute on function public.teto_dos_chips() from anon, public;
grant  execute on function public.teto_dos_chips() to authenticated;
