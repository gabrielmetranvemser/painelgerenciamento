-- =============================================================================
-- Onze desfechos, e "Falar depois" que de fato volta
-- =============================================================================
-- Eram cinco: autorizou, pediu saída, número inválido, quer ajudar, encaminhar.
-- Os testes com os atendentes mostraram o que faltava — e o que acontecia
-- quando faltava: quem não achava onde encaixar a conversa marcava o botão de
-- nome mais parecido para poder seguir. Um relatório que registra "número
-- inválido" onde houve "atendeu outra pessoa" é pior que um relatório com uma
-- coluna a menos, porque parece certo.
--
-- Os seis que entram:
--   ja_apoia         já é apoiador
--   falar_depois     pediu para falar noutra hora — VOLTA para a fila dele
--   sem_resposta     já existia no enum; passa a ser marcável
--   nao_e_a_pessoa   o número trocou de dono
--   mudou_de_estado  saiu de Rondônia
--   outro            o resto, com uma linha escrita
--
-- ⚠️ SOBRE O CAMPO LIVRE. `contatos.encaminhamento` era exclusivo de
-- "Encaminhar", e a migration 350000 apertou isso de propósito: é o ÚNICO campo
-- de texto livre do sistema, e portanto o único lugar onde caberia, por engano,
-- uma anotação de preferência de voto — que é vedada (CLAUDE.md, regra 4).
-- "Outro" passa a poder gravar nele, e só ele: a lista de resultados que
-- aceitam texto continua fechada, aqui no servidor, e continua com duas
-- entradas. A tela avisa em todas as vezes que não se escreve em quem a pessoa
-- vota.

-- ── "Falar depois" precisa voltar ───────────────────────────────────────────
-- Sem isto o desfecho seria um beco: a tela promete "volta para a sua fila em
-- 1 dia" e a fila só olhava para `status = 'na_fila'`. Promessa de tela que o
-- servidor não cumpre é pior que não ter o botão.
--
-- Um dia é o padrão porque "depois" quase sempre quer dizer "hoje não". O
-- contato continua PRESO ao atendente (`atendente_id` intacto), então volta
-- para quem já falou com a pessoa.
--
-- Esta função é o critério de "quem a fila entrega": o que está na fila comum,
-- mais o que este atendente reagendou e já venceu.
--
-- ⚠️ Existe como função porque o critério aparece em DOIS lugares —
-- `pegar_proximo_contato`, que entrega, e `fila_status`, que conta. Eles já
-- vinham duplicados, e o comentário de `listas_por_atendente` avisa o porquê de
-- isso ser perigoso: contador que promete contato e botão que não entrega é o
-- defeito clássico daqui. Com uma função só, os dois não têm como divergir.
--
-- `stable`, não `immutable`: lê `now()`.
create or replace function public.status_entregavel(
  p_status       public.status_contato,
  p_atendente_id uuid,
  p_uid          uuid
)
returns boolean
language sql stable
as $$
  select p_status = 'na_fila'
      -- Reagendado volta só para quem o reagendou: quem já conversou com a
      -- pessoa é quem tem o contexto do que ficou combinado. A hora de voltar
      -- é conferida pelo filtro de `adiado_ate`, que já existe nas duas
      -- funções e vale para todo mundo.
      or (p_status = 'falar_depois' and p_atendente_id = p_uid);
$$;

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
  v_origem  text;
  v_texto   boolean;
begin
  if p_resultado not in (
    'autorizou','pediu_saida','invalido','quer_ajudar','encaminhado',
    'ja_apoia','falar_depois','sem_resposta','nao_e_a_pessoa','mudou_de_estado','outro'
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
  end if;

  -- A lista de quem aceita texto livre. Fechada, e conferida no SERVIDOR: a
  -- tela também filtra, mas tela se burla com o DevTools aberto.
  v_texto := p_resultado in ('encaminhado', 'outro');

  select * into v_contato from public.contatos where id = p_contato_id for update;

  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;

  -- Anti-fraude: só há resultado se houve conversa.
  if not exists (
    select 1 from public.interacoes i
     where i.contato_id = p_contato_id and i.aberto_wa_em is not null
  ) then
    return jsonb_build_object('ok', false, 'motivo', 'conversa_nao_aberta');
  end if;

  if v_contato.status in ('perdido', 'na_fila', 'novo') then
    return jsonb_build_object('ok', false, 'motivo', 'contato_fora_de_atendimento');
  end if;

  -- ── Correção de um "Pediu saída" ──────────────────────────────────────────
  if v_contato.status = 'pediu_saida' and p_resultado <> 'pediu_saida' then
    if v_contato.anonimizado_em is not null then
      return jsonb_build_object('ok', false, 'motivo', 'dados_ja_apagados');
    end if;

    select b.origem into v_origem
      from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac;

    if v_origem = 'landing' then
      return jsonb_build_object('ok', false, 'motivo', 'saida_pedida_pela_pessoa');
    end if;

    if not exists (
      select 1 from public.alertas a
       where a.tipo = 'saida_para_revisar'
         and a.contato_id = p_contato_id
         and a.resolvido_em is null
    ) then
      insert into public.alertas (tipo, atendente_id, contato_id, detalhe)
      values ('saida_para_revisar', v_uid, p_contato_id,
              'Um atendente marcou "Pediu saída" e agora diz que foi engano — quer mudar para "' ||
              p_resultado || '". O número CONTINUA bloqueado até você decidir. ' ||
              'Liberar devolve a pessoa para a conversa com o mesmo atendente.');
    end if;

    return jsonb_build_object('ok', false, 'motivo', 'saida_so_o_gestor_desfaz');
  end if;

  -- ── Correção de um desfecho já registrado deixa rastro ───────────────────
  -- ⚠️ `falar_depois` está de fora, e não por descuido: ele é o único desfecho
  -- que NASCE esperando ser trocado. A conversa volta no dia seguinte e ganha
  -- um desfecho de verdade — se isso virasse alerta, o gestor receberia um
  -- aviso de "resultado corrigido" por cada reagendamento que deu certo, e o
  -- sinal que importa (alguém trocou "Autorizou" por "Número inválido" três
  -- dias depois) se perderia no meio.
  if v_contato.status not in ('em_atendimento', 'falar_depois')
     and v_contato.status <> p_resultado then
    insert into public.alertas (tipo, atendente_id, contato_id, detalhe)
    values ('resultado_corrigido', v_uid, p_contato_id,
            'Um resultado já registrado foi trocado de "' || v_contato.status ||
            '" para "' || p_resultado || '".');
  end if;

  update public.contatos
     set status          = p_resultado,
         resultado_em    = now(),
         -- A reserva de 20 minutos morre em todos os casos: a conversa desta
         -- sessão acabou. Quem guarda o reagendado para o atendente é o par
         -- `atendente_id` + `status`, conferido por `status_entregavel` — e
         -- não a reserva, que existe para outra coisa (impedir que dois
         -- atendentes peguem o mesmo contato agora).
         claim_expira_em = null,
         municipio_id    = coalesce(p_municipio_id, municipio_id),
         -- Volta para a fila DELE amanhã. Nos outros desfechos o adiamento é
         -- zerado: um contato encerrado não tem "depois".
         adiado_ate      = case when p_resultado = 'falar_depois'
                                then now() + interval '1 day'
                                else null end,
         encaminhamento  = case when v_texto
                                then coalesce(p_encaminhamento, encaminhamento)
                                else encaminhamento end
   where id = p_contato_id;

  update public.interacoes
     set resultado = p_resultado, resultado_em = now()
   where contato_id = p_contato_id and aberto_wa_em is not null;

  if p_resultado = 'pediu_saida' then
    insert into public.bloqueios (telefone_hmac, hmac_versao, motivo, origem, contato_id, apagar_em)
    values (v_contato.telefone_hmac, v_contato.hmac_versao, 'Pediu saída no atendimento',
            'pediu_saida', p_contato_id, now() + interval '48 hours')
    on conflict (telefone_hmac) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', p_resultado,
    'volta_em', case when p_resultado = 'falar_depois' then now() + interval '1 day' end
  );
end;
$$;


-- ── A fila passa a enxergar os reagendados ──────────────────────────────────
-- As duas funções vêm inteiras da versão anterior. O que muda é UMA linha em
-- cada: o predicado de status, que agora sai de `status_entregavel`. Vêm
-- inteiras porque `create or replace` substitui o corpo todo — não há como
-- alterar uma linha de uma função no Postgres.

create or replace function public.pegar_proximo_contato(
  p_chip_id  uuid,
  /** Trabalhar uma lista só. Nulo = todas as listas do atendente, misturadas. */
  p_lista_id uuid default null
)
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

  -- Contato já na mão volta inteiro, sem passar por filtro nenhum — nem o da
  -- lista marcada, nem o da lista pedida em `p_lista_id`.
  --
  -- É a trava que impede recarregar a página de pular alguém, e ela vem antes
  -- de tudo de propósito: se o gestor tirou a lista da pessoa no meio do
  -- atendimento, ou se ela trocou de lista com um contato reservado, quem está
  -- do outro lado já foi abordado e merece o fim da conversa. Trocar de lista
  -- vale para o PRÓXIMO contato, não para o que já está na tela.
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
      'fila', public.fila_status(p_chip_id, p_lista_id)
    );
  end if;

  -- Aqui dentro é que a lista escolhida é conferida: se ela não for deste
  -- atendente, ou estiver pausada, a resposta é `lista_nao_e_sua` e nada é
  -- entregue.
  v_status := public.fila_status(p_chip_id, p_lista_id);
  if not (v_status->>'pode')::boolean then
    return jsonb_build_object('ok', false, 'motivo', v_status->>'motivo', 'fila', v_status);
  end if;

  select c.id into v_id
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
     -- ── a lista ──
     and (
       -- Captação: quem se cadastrou sozinho não é de lista nenhuma.
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
     -- Trabalhando uma lista só: nem a captação entra, senão o atendente que
     -- escolheu "lista do bairro" receberia gente de fora dela.
     and (p_lista_id is null or c.lista_id = p_lista_id)
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
    'fila', public.fila_status(p_chip_id, p_lista_id)
  );
end;
$$;

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
