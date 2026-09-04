-- =============================================================================
-- Recepção no WhatsApp: quem preenche o formulário manda a primeira mensagem
-- =============================================================================
-- Depois de cadastrar, a pessoa é levada ao WhatsApp de um número da campanha,
-- com um texto já escrito, que ELA envia. O número sai de um rodízio.
--
-- ⚠️ ISTO NÃO É ENVIO AUTOMÁTICO, e a diferença é a que sustenta o projeto
-- inteiro (CLAUDE.md, primeiro princípio). O sistema não manda nada: ele abre o
-- WhatsApp DA PESSOA com o texto preenchido, e ela aperta enviar. A mensagem
-- sai do aparelho dela para a campanha — é ENTRADA, não saída. Na prática é a
-- posição mais forte que esta operação pode ter: em vez de a campanha abordar,
-- o eleitor procura a campanha, por escrito, depois de já ter dado o aceite no
-- formulário.
--
-- ⚠️ RODÍZIO, E NÃO SORTEIO CEGO.
--
-- O pedido foi "2 números 50/50, 3 números 33/33/33". Sorteio aleatório NÃO faz
-- isso: com 10 cadastros, 7/3 é resultado comum. Quem sai é sempre quem está
-- mais atrás na proporção (`sorteios / peso`), o que entrega a divisão exata
-- pedida — e `peso` permite fugir dela de propósito (um número com peso 2
-- recebe o dobro).
--
-- ⚠️ O NÚMERO PODE APONTAR PARA UM ATENDENTE, E ISSO RESERVA O CONTATO.
--
-- Se a pessoa escreve para o número do Vitor, a conversa está no WhatsApp do
-- Vitor. Se a Laura puxasse esse contato da fila e abrisse outra conversa, a
-- pessoa receberia dois chats da mesma campanha — que é exatamente o que parece
-- spam. Por isso o contato fica reservado para o dono do número.
--
-- Mas a reserva EXPIRA (`config.reserva_recepcao_horas`). Reserva sem prazo
-- deixaria o lead mais quente do sistema parado porque o dono do número folgou
-- naquele dia — e essa pessoa acabou de escrever esperando resposta.

-- ── Os números de cada candidato ────────────────────────────────────────────
create table if not exists public.numeros_recepcao (
  id           uuid primary key default gen_random_uuid(),
  candidato_id uuid not null references public.candidatos(id) on delete cascade,
  rotulo       text not null,
  -- Mesmo formato de `contatos.telefone_e164`: só dígitos, sem o "+". É o que
  -- a URL do WhatsApp espera, e misturar formato aqui produz um link que abre
  -- uma conversa vazia com um número inexistente.
  numero_e164  text not null,
  -- De quem é este número DENTRO do painel. Nulo é válido: pode ser um número
  -- da campanha que não é de nenhum atendente cadastrado. Sem dono, não há
  -- para quem reservar, e o contato segue a fila normal.
  atendente_id uuid references public.usuarios(id) on delete set null,
  peso         int not null default 1,
  ativo        boolean not null default true,
  -- Quantas vezes já saiu. É o que faz o rodízio ser rodízio.
  sorteios     int not null default 0,
  ultimo_em    timestamptz,
  criado_em    timestamptz not null default now(),

  constraint recepcao_rotulo_util check (length(btrim(rotulo)) between 2 and 40),
  constraint recepcao_numero_e164 check (numero_e164 ~ '^55[0-9]{10,11}$'),
  constraint recepcao_peso_util   check (peso between 1 and 10)
);

create unique index if not exists numeros_recepcao_uk
  on public.numeros_recepcao (candidato_id, numero_e164);
create index if not exists numeros_recepcao_candidato_idx
  on public.numeros_recepcao (candidato_id) where ativo;

alter table public.numeros_recepcao enable row level security;

drop policy if exists numeros_recepcao_gestor on public.numeros_recepcao;
create policy numeros_recepcao_gestor on public.numeros_recepcao
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── O texto que a pessoa vai enviar ─────────────────────────────────────────
-- ⚠️ Nulo = usa o padrão do código. NÃO passa por `validarModelo`: aquelas
-- regras (identificação da propaganda, saída, chapa declarada) existem para
-- mensagem da CAMPANHA PARA O ELEITOR. Esta é do eleitor para a campanha, e
-- exigir CNPJ num "oi, acabei de pedir o material" seria absurdo.
alter table public.candidatos
  add column if not exists mensagem_recepcao text;

comment on column public.candidatos.mensagem_recepcao is
  'Texto que a pessoa envia ao ser levada ao WhatsApp. Dela para a campanha. '
  'Nulo = o padrão do código. Variáveis: {{nome}} {{primeiro_nome}} {{cidade}} '
  '{{candidato}} {{pedido}}.';

-- ── Quanto tempo o dono do número segura o contato ──────────────────────────
alter table public.config
  add column if not exists reserva_recepcao_horas int not null default 4;

alter table public.config drop constraint if exists reserva_recepcao_horas_util;
alter table public.config add constraint reserva_recepcao_horas_util
  check (reserva_recepcao_horas between 0 and 72);

comment on column public.config.reserva_recepcao_horas is
  'Horas que o dono do número da recepção segura o contato antes de ele abrir '
  'para o resto da chapa. Zero desliga a reserva.';

-- ── A reserva, no contato ───────────────────────────────────────────────────
alter table public.contatos
  add column if not exists reservado_para uuid references public.usuarios(id) on delete set null,
  add column if not exists reservado_ate  timestamptz;

comment on column public.contatos.reservado_para is
  'Dono do número para o qual esta pessoa foi levada depois do formulário. '
  'A conversa já está no WhatsApp dele. Ver a migration recepcao_no_whatsapp.';

create index if not exists contatos_reservado_idx
  on public.contatos (reservado_para, reservado_ate) where reservado_para is not null;

-- ── O rodízio ───────────────────────────────────────────────────────────────
create or replace function public.sortear_numero_recepcao(
  p_candidato_id uuid,
  p_contato_id   uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_n     public.numeros_recepcao%rowtype;
  v_horas int;
begin
  if p_candidato_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_candidato');
  end if;

  -- Quem está mais atrás na proporção. O `random()` só desempata — sem ele, com
  -- todos zerados, o primeiro cadastro do dia sairia sempre para o mesmo.
  --
  -- `skip locked` porque dois cadastros simultâneos pegariam a MESMA linha e o
  -- rodízio contaria uma vez só: o segundo espera a primeira transação e lê o
  -- valor velho. Pulando a linha travada, ele leva a próxima — que é
  -- exatamente o comportamento certo para dividir.
  select * into v_n
    from public.numeros_recepcao
   where candidato_id = p_candidato_id and ativo
   order by sorteios::numeric / greatest(peso, 1), random()
     for update skip locked
   limit 1;

  if v_n.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_numero');
  end if;

  update public.numeros_recepcao
     set sorteios = sorteios + 1, ultimo_em = now()
   where id = v_n.id;

  select reserva_recepcao_horas into v_horas from public.config where id = 1;

  -- Reserva só quando há dono E o contato ainda está livre. Contato que já está
  -- na mão de alguém não é tomado: a conversa em andamento manda.
  if v_n.atendente_id is not null and p_contato_id is not null and coalesce(v_horas, 0) > 0 then
    update public.contatos
       set reservado_para = v_n.atendente_id,
           reservado_ate  = now() + make_interval(hours => v_horas)
     where id = p_contato_id
       and atendente_id is null;
  end if;

  return jsonb_build_object(
    'ok', true,
    'numero', v_n.numero_e164,
    'rotulo', v_n.rotulo,
    'atendente_id', v_n.atendente_id
  );
end;
$$;

comment on function public.sortear_numero_recepcao(uuid, uuid) is
  'Escolhe o próximo número da recepção por RODÍZIO (não sorteio) e reserva o '
  'contato para o dono dele. Ver a migration recepcao_no_whatsapp.';

-- ── As cinco funções da fila respeitam a reserva ────────────────────────────
-- Os corpos abaixo são os que estavam no banco, com UMA inserção em cada. A
-- regra tem de valer nas cinco: se sobrar uma, o contato reservado aparece por
-- ali para outro atendente, e a pessoa recebe conversa de dois lugares.
-- ── fila_status ─────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fila_status(p_chip_id uuid, p_lista_id uuid DEFAULT NULL::uuid)
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
     -- Reserva da recepção: quem escreveu para o número do Vitor é do
     -- Vitor enquanto ela vale. Depois do prazo, volta a valer para todos.
     and (
       c.reservado_para is null
       or c.reservado_para = v_uid
       or c.reservado_ate is null
       or c.reservado_ate <= now()
     )
     and (
       c.candidato_origem_id is null
       or public.recebe_captacao_de(v_uid, c.candidato_origem_id)
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

-- ── fila_do_atendente ───────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.fila_do_atendente(p_lista_id uuid DEFAULT NULL::uuid, p_busca text DEFAULT NULL::text, p_limite integer DEFAULT 40)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_busca   text;
  v_r       jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('erro', 'sem_sessao');
  end if;

  p_limite := least(greatest(coalesce(p_limite, 40), 1), 100);
  v_busca  := nullif(btrim(coalesce(p_busca, '')), '');

  if p_lista_id is not null and not exists (
    select 1 from public.atendente_listas al
     join public.listas l on l.id = al.lista_id
    where al.atendente_id = v_uid and al.lista_id = p_lista_id and l.ativa
  ) then
    return jsonb_build_object('erro', 'lista_nao_e_sua');
  end if;

  -- ⚠️ `t.ordem`, e não `x.ordem`: `x` é a coluna jsonb, `t` é a subconsulta.
  -- Ver o cabeçalho — este erro derrubou a tela inteira.
  select coalesce(jsonb_agg(t.x order by t.ordem), '[]'::jsonb) into v_r
    from (
      select jsonb_build_object(
               'id', c.id,
               -- ⚠️ NOME COMPLETO, e não o primeiro. Esta é uma tela de
               -- ESCOLHA: com `coalesce(primeiro_nome, nome)` a busca por
               -- "Espetinho" devolvia cinco linhas escritas "Espetinho", e o
               -- atendente não tinha como saber qual era o Delegado, qual era
               -- o Esmerindo e qual era o Mariano. O primeiro nome serve para
               -- a MENSAGEM ("Oi, Espetinho!"); para identificar gente numa
               -- lista, ele apaga justamente o que distingue.
               'nome', coalesce(nullif(btrim(c.nome), ''), c.primeiro_nome),
               'telefone_e164', c.telefone_e164,
               'origem', c.origem,
               'municipio', (select m.nome from public.municipios m where m.id = c.municipio_id),
               'lista_id', c.lista_id,
               'lista', (select l.rotulo from public.listas l where l.id = c.lista_id),
               'criado_em', c.criado_em,
               'reagendado', c.status = 'falar_depois'
             ) as x,
             row_number() over (
               order by (c.status = 'falar_depois') desc,
                        (c.atendente_id = v_uid) desc nulls last,
                        (c.origem = 'lista_fria'),
                        c.criado_em
             ) as ordem
        from public.contatos c
       where public.status_entregavel(c.status, c.atendente_id, v_uid)
         and c.telefone_e164 is not null
         and (c.atendente_id is null or c.atendente_id = v_uid)
         and (c.adiado_ate is null or c.adiado_ate <= now())
         and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac)
         -- Reserva da recepção: quem escreveu para o número do Vitor é do
         -- Vitor enquanto ela vale. Depois do prazo, volta a valer para todos.
         and (
           c.reservado_para is null
           or c.reservado_para = v_uid
           or c.reservado_ate is null
           or c.reservado_ate <= now()
         )
         and (
           c.candidato_origem_id is null
           or public.recebe_captacao_de(v_uid, c.candidato_origem_id)
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
         and (p_lista_id is null or c.lista_id = p_lista_id)
         -- Busca só por NOME. Ver o cabeçalho.
         and (v_busca is null or c.nome ilike '%' || v_busca || '%')
       order by ordem
       limit p_limite
    ) t;

  return jsonb_build_object('ok', true, 'linhas', v_r);
end;
$function$;

-- ── minhas_listas ───────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.minhas_listas()
 RETURNS TABLE(id uuid, rotulo text, origem origem_contato, na_fila integer)
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
AS $function$
  select
    l.id,
    l.rotulo,
    l.origem,
    (select count(*)::int
       from public.contatos c
      where c.lista_id = l.id
        and c.status = 'na_fila'
        and c.telefone_e164 is not null
        and (c.atendente_id is null or c.atendente_id = (select auth.uid()))
        and (c.adiado_ate is null or c.adiado_ate <= now())
        and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac)
        -- Reserva da recepção: quem escreveu para o número do Vitor é do
        -- Vitor enquanto ela vale. Depois do prazo, volta a valer para todos.
        and (
          c.reservado_para is null
          or c.reservado_para = (select auth.uid())
          or c.reservado_ate is null
          or c.reservado_ate <= now()
        )
        and (
          c.candidato_origem_id is null
          or public.recebe_captacao_de((select auth.uid()), c.candidato_origem_id)
        )
    ) as na_fila
  from public.atendente_listas al
  join public.listas l on l.id = al.lista_id
  where al.atendente_id = (select auth.uid())
    and l.ativa
  order by l.criado_em;
$function$;

-- ── pegar_proximo_contato ───────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pegar_proximo_contato(p_chip_id uuid, p_lista_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
     -- Reserva da recepção: quem escreveu para o número do Vitor é do
     -- Vitor enquanto ela vale. Depois do prazo, volta a valer para todos.
     and (
       c.reservado_para is null
       or c.reservado_para = v_uid
       or c.reservado_ate is null
       or c.reservado_ate <= now()
     )
     and (
       c.candidato_origem_id is null
       or public.recebe_captacao_de(v_uid, c.candidato_origem_id)
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
$function$;

-- ── pegar_contato_especifico ────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.pegar_contato_especifico(p_contato_id uuid, p_chip_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_cfg     public.config%rowtype;
  v_status  jsonb;
  v_contato public.contatos%rowtype;
  v_id      uuid;
begin
  select * into v_cfg from public.config where id = 1;

  -- Contato já na mão volta inteiro, sem passar por filtro nenhum — a mesma
  -- trava de `pegar_proximo_contato`, e pelo mesmo motivo: quem já foi abordado
  -- merece o fim da conversa. Escolher outro no meio de um atendimento não
  -- larga o que está na tela.
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
   where c.id = p_contato_id
     and public.status_entregavel(c.status, c.atendente_id, v_uid)
     and c.telefone_e164 is not null
     and (c.atendente_id is null or c.atendente_id = v_uid)
     and (c.adiado_ate is null or c.adiado_ate <= now())
     and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac)
     -- Reserva da recepção: quem escreveu para o número do Vitor é do
     -- Vitor enquanto ela vale. Depois do prazo, volta a valer para todos.
     and (
       c.reservado_para is null
       or c.reservado_para = v_uid
       or c.reservado_ate is null
       or c.reservado_ate <= now()
     )
     and (
       c.candidato_origem_id is null
       or public.recebe_captacao_de(v_uid, c.candidato_origem_id)
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
   for update skip locked;

  -- Um motivo só para "não existe", "não é sua lista", "alguém pegou primeiro"
  -- e "está bloqueado": a tela não deve virar um oráculo que diz o que existe
  -- na base fora do alcance de quem pergunta.
  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'contato_indisponivel', 'fila', v_status);
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
$function$;

-- ── Acrescentar um número sem quebrar o rodízio ─────────────────────────────
-- ⚠️ Número novo NÃO entra com zero.
--
-- O rodízio escolhe quem está mais atrás. Um número novo zerado, ao lado de um
-- que já saiu 300 vezes, levaria os 300 cadastros seguintes sozinho — o oposto
-- do "50/50" que o gestor pediu, e ele descobriria pelo atendente reclamando de
-- enxurrada. Entrando empatado com quem mais recebeu, a divisão daqui para a
-- frente é igual, que é o que ele quis dizer.
create or replace function public.criar_numero_recepcao(
  p_candidato_id uuid,
  p_rotulo       text,
  p_numero       text,
  p_atendente_id uuid default null,
  p_peso         int  default 1
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid; v_base int;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'somente_gestor');
  end if;

  select coalesce(max(sorteios), 0) into v_base
    from public.numeros_recepcao
   where candidato_id = p_candidato_id and ativo;

  insert into public.numeros_recepcao
    (candidato_id, rotulo, numero_e164, atendente_id, peso, sorteios)
  values (p_candidato_id, btrim(p_rotulo), p_numero, p_atendente_id,
          coalesce(p_peso, 1), v_base)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id, 'sorteios', v_base);
end;
$$;

comment on function public.criar_numero_recepcao(uuid, text, text, uuid, int) is
  'Acrescenta um número da recepção JÁ EMPATADO com quem mais recebeu, para o '
  'rodízio não despejar todos os próximos cadastros nele.';
