-- =============================================================================
-- Cada lista tem dono. A fila deixa de ser um bolo só.
-- =============================================================================
-- ANTES: dez planilhas importadas viravam uma fila única. `pegar_proximo_contato`
-- ordenava por quente→frio e data, e entregava qualquer contato a qualquer
-- atendente. Não havia como dizer "esta lista é do Filipe" — e a operação
-- precisa disso: lista de bairro, lista de município, lista que um apoiador
-- entregou para falar com a base DELE. Misturar tudo faz o atendente de Vilhena
-- ligar para Porto Velho.
--
-- DEPOIS: `atendente_listas` diz quem atende o quê. A fila só entrega um
-- contato de lista a quem tem aquela lista marcada. Lista marcada para duas
-- pessoas continua sendo dividida pelo mesmo `for update skip locked` de
-- sempre — ninguém fala com a mesma pessoa duas vezes.
--
-- Três decisões que não são óbvias:
--
-- 1. SEM MARCAÇÃO = NÃO RECEBE. O contrário ("sem marcação recebe tudo") seria
--    mais macio no dia do deploy, mas transforma o esquecimento do gestor em
--    vazamento silencioso: a lista que ele quis dar só ao Gabriel continuaria
--    caindo no Filipe, e nada na tela denunciaria. Aqui o esquecimento PARA a
--    fila da pessoa, que é um defeito barulhento — e a recusa tem motivo
--    próprio (`sem_lista`), com a frase certa na tela do atendente e o aviso
--    correspondente na tela do gestor.
--
-- 2. CONTATO SEM LISTA CONTINUA DE TODO MUNDO. Quem se cadastrou sozinho pela
--    página do candidato (`lista_id is null`) não pertence a lista nenhuma e é
--    o contato mais valioso que existe: ele PEDIU para ser chamado. Prender
--    esse contato a uma marcação de lista seria deixá-lo esfriando na base.
--
-- 3. PAUSAR A LISTA TIRA DA FILA, MAS NÃO INTERROMPE CONVERSA VIVA. Quem já
--    está com o contato na mão termina o que começou: a pessoa do outro lado
--    já recebeu a permissão e está esperando o material. Pausar serve para
--    parar de PROCURAR gente daquela lista, não para sumir no meio da frase.
--
-- 4. O ATENDENTE PODE ESCOLHER UMA LISTA DE CADA VEZ. Por padrão a fila mistura
--    todas as listas dele (e o contato chega etiquetado com a lista de onde
--    veio). Quem quiser trabalhar uma lista só passa `p_lista_id` — e o
--    servidor confere se aquela lista é mesmo daquela pessoa, porque escolha de
--    tela se burla com o DevTools aberto.

-- ── Quem atende qual lista ──────────────────────────────────────────────────
create table if not exists public.atendente_listas (
  atendente_id uuid not null references public.usuarios(id) on delete cascade,
  lista_id     uuid not null references public.listas(id)   on delete cascade,
  criado_em    timestamptz not null default now(),
  primary key (atendente_id, lista_id)
);

-- A chave primária já serve o lado "as listas deste atendente", que é o que a
-- fila consulta. Este índice serve o lado inverso — "quem atende esta lista" —
-- que é a tela do gestor e o `delete` em cascata.
create index if not exists atendente_listas_lista_idx
  on public.atendente_listas (lista_id);

alter table public.atendente_listas enable row level security;

-- Mesmo desenho da chapa (`atendente_candidatos`): o atendente LÊ a própria
-- atribuição, e só o gestor escreve. Deixar o atendente escrever aqui seria
-- deixá-lo escolher a própria carteira de contatos.
create policy listas_do_atendente_minhas on public.atendente_listas
  for select to authenticated
  using (atendente_id = (select auth.uid()) or public.is_gestor());
create policy listas_do_atendente_gestor on public.atendente_listas
  for all to authenticated
  using (public.is_gestor()) with check (public.is_gestor());

-- ── A tela de listas precisa de números, não de linhas ──────────────────────
-- Sem isto a página teria de baixar os contatos para contar no navegador, e a
-- base tem dezenas de milhares.
create or replace view public.v_listas with (security_invoker = on) as
select
  l.*,
  coalesce(t.total, 0)   as contatos_total,
  coalesce(t.na_fila, 0) as contatos_na_fila,
  coalesce(t.falados, 0) as contatos_falados
from public.listas l
left join lateral (
  select count(*)                                                  as total,
         count(*) filter (where c.status = 'na_fila')              as na_fila,
         count(*) filter (where c.primeiro_contato_em is not null) as falados
    from public.contatos c
   where c.lista_id = l.id
) t on true;

-- ── O esquecimento tem de ser barulhento ────────────────────────────────────
-- "Sem marcação = não recebe" só é uma boa regra se o gestor VÊ quem ficou de
-- fora. Esta view alimenta o contador do menu e o aviso das telas de Atendentes
-- e de Listas: enquanto houver alguém aqui, tem gente sentada sem fila.
create or replace view public.v_atendentes_sem_lista with (security_invoker = on) as
select u.id, u.primeiro_nome
  from public.usuarios u
 where u.papel = 'atendente'
   and u.ativo
   and not exists (
     select 1
       from public.atendente_listas al
       join public.listas l on l.id = al.lista_id
      where al.atendente_id = u.id
        and l.ativa
   );

-- ── O contato chega dizendo de que lista veio ───────────────────────────────
-- É o que permite a etiqueta na tela do atendente. Sem ela, o atendente que
-- atende três listas não sabe se está falando com quem pediu o kit ou com quem
-- um apoiador indicou — e o tom da conversa é outro.
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
    'lista_id',      c.lista_id,
    'lista',         (select l.rotulo from public.listas l where l.id = c.lista_id),
    'claim_expira_em', c.claim_expira_em
  );
$$;

-- ── As duas funções da fila ganham a lista escolhida ────────────────────────
-- `drop` antes de `create`: acrescentar um parâmetro com valor padrão NÃO
-- substitui a função antiga, cria uma segunda. As duas conviveriam e toda
-- chamada com um argumento só passaria a ser ambígua — erro em tempo de
-- execução, na cara do atendente, no meio do turno.
drop function if exists public.pegar_proximo_contato(uuid);
drop function if exists public.fila_status(uuid);

-- ── A fila passa a respeitar a lista ────────────────────────────────────────
-- ⚠️ O predicado abaixo aparece DUAS vezes: aqui, no claim, e em
-- `fila_status`, no contador. Ele é repetido de propósito, e não extraído para
-- uma função: `security definer` não é inlineável pelo planejador, e este
-- predicado roda dentro do `for update skip locked` que varre a fila inteira.
-- Em compensação, os dois têm de andar juntos — quando divergiram por causa do
-- candidato (migration 220200) o painel dizia "1 quente na fila", o atendente
-- clicava e recebia "não há mais contatos". Há teste de banco que confere que
-- contador e claim concordam.
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

-- ── E o contador usa o MESMO critério ───────────────────────────────────────
-- Base: migration 330500 (a ordem das recusas). O que muda aqui é o filtro de
-- lista nos contadores e a recusa `sem_lista`, que separa "você não está em
-- nenhuma lista" de "acabaram os contatos" — duas frases que mandam o
-- atendente para lugares diferentes.
create or replace function public.fila_status(
  p_chip_id  uuid,
  /** A lista escolhida, quando o atendente está trabalhando uma só. */
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
  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return v_vazio || jsonb_build_object('motivo', 'chip_nao_e_seu');
  end if;

  -- A lista escolhida chega do navegador. Ela só vale se for mesmo deste
  -- atendente e estiver ativa — senão bastaria trocar um id no DevTools para
  -- puxar a carteira do colega.
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

  -- Lista ATIVA. Só lista pausada é o mesmo que lista nenhuma: a fila não
  -- entrega nada dela, e a tela precisa dizer isso com a frase de `sem_lista`.
  select exists (
    select 1 from public.atendente_listas al
     join public.listas l on l.id = al.lista_id
    where al.atendente_id = v_uid and l.ativa
  ) into v_tem_lista;

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
    -- A fila vazia de quem não tem lista NÃO é fila vazia: é configuração
    -- faltando. Mandar "não há mais contatos" para alguém que nunca vai
    -- receber contato nenhum é o tipo de mentira que consome um turno inteiro
    -- antes de alguém desconfiar.
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

-- ── As listas do atendente, com o que ainda falta em cada uma ───────────────
-- Alimenta as duas formas de trabalhar: no automático mostra QUAIS listas a
-- pessoa atende; no manual, é o cardápio para escolher uma.
--
-- ⚠️ Terceira cópia do predicado de disponibilidade. As outras duas —
-- `pegar_proximo_contato` e `fila_status` — TÊM de andar juntas, porque uma
-- promete e a outra entrega. Esta aqui é só um número na tela: se ela divergir,
-- o estrago é uma contagem torta; se aquelas divergirem, o atendente clica e
-- não recebe nada. Mesmo assim há teste de banco conferindo que as três
-- concordam.
create or replace function public.minhas_listas()
returns table (id uuid, rotulo text, origem public.origem_contato, na_fila int)
language sql stable security definer set search_path = ''
as $$
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
        and (
          c.candidato_origem_id is null
          or exists (
            select 1 from public.atendente_candidatos ac
             where ac.atendente_id = (select auth.uid())
               and ac.candidato_id = c.candidato_origem_id
          )
        )
    ) as na_fila
  from public.atendente_listas al
  join public.listas l on l.id = al.lista_id
  where al.atendente_id = (select auth.uid())
    and l.ativa
  order by l.criado_em;
$$;

-- ── Permissões ──────────────────────────────────────────────────────────────
-- O `drop`/`create` acima apagou as concessões das assinaturas antigas: sem
-- estas linhas, `authenticated` perde a fila inteira.
revoke execute on function public.pegar_proximo_contato(uuid, uuid) from anon, public;
revoke execute on function public.fila_status(uuid, uuid) from anon, public;
revoke execute on function public.minhas_listas() from anon, public;

grant execute on function public.pegar_proximo_contato(uuid, uuid) to authenticated;
grant execute on function public.fila_status(uuid, uuid) to authenticated;
grant execute on function public.minhas_listas() to authenticated;
