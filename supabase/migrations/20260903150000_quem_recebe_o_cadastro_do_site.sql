-- =============================================================================
-- Escolher quem recebe os cadastros que chegam pelo formulário
-- =============================================================================
-- Quem preenche a página de um candidato entra na fila QUENTE, e desde
-- `captacao_por_candidato` só é oferecido a quem atende aquele candidato. O que
-- faltava era escolher, dentro da chapa, QUEM recebe — hoje é quem clicar
-- primeiro, e numa equipe com gente de perfil diferente isso manda a pessoa que
-- pediu material para quem está no meio de uma lista fria.
--
-- ⚠️ A MARCA VIVE EM `atendente_candidatos`, e não numa tabela nova.
--
-- A linha que diz "este atendente atende este candidato" já existe. "E recebe os
-- cadastros dele" é uma qualidade DAQUELE vínculo, não um vínculo à parte: numa
-- tabela separada seria possível marcar alguém que nem atende o candidato, e o
-- lead ficaria apontando para quem não pode falar dele.
--
-- ⚠️ NINGUÉM MARCADO = TODOS RECEBEM, e isso é deliberado.
--
-- É o comportamento de hoje, então ligar esta migration não muda nada até
-- alguém ser marcado. E fecha o modo de falha que importa: se a marca fosse
-- obrigatória, esquecer de marcar deixaria gente que PEDIU material esperando
-- sem ninguém saber — e essa é a pessoa mais quente que este sistema tem.
--
-- Repare que é o OPOSTO da regra de `atendente_listas`, onde ausência de linha
-- quer dizer "não recebe nada". Lá a ausência protege (lista fria entregue a
-- quem não devia é denúncia); aqui a ausência é que seria o estrago.

alter table public.atendente_candidatos
  add column if not exists recebe_captacao boolean not null default false;

comment on column public.atendente_candidatos.recebe_captacao is
  'Recebe os cadastros que chegam pelo formulário deste candidato. '
  'Se NINGUÉM do candidato estiver marcado, todos que o atendem recebem.';

-- ── A regra, num lugar só ───────────────────────────────────────────────────
-- Cinco funções da fila fazem esta pergunta. Escrever a condição nas cinco é
-- garantir que um dia elas divirjam — e a que ficar para trás vai entregar o
-- lead para quem o gestor tirou da lista, sem sintoma nenhum.
create or replace function public.recebe_captacao_de(
  p_atendente uuid,
  p_candidato uuid
)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
           select 1 from public.atendente_candidatos ac
            where ac.atendente_id = p_atendente and ac.candidato_id = p_candidato
         )
     and (
           -- Ninguém escolhido neste candidato: vale para a chapa inteira.
           not exists (
             select 1 from public.atendente_candidatos ac
              where ac.candidato_id = p_candidato and ac.recebe_captacao
           )
           or exists (
             select 1 from public.atendente_candidatos ac
              where ac.atendente_id = p_atendente
                and ac.candidato_id = p_candidato
                and ac.recebe_captacao
           )
         );
$$;

comment on function public.recebe_captacao_de(uuid, uuid) is
  'Este atendente recebe os cadastros de formulário deste candidato? '
  'Ver a migration quem_recebe_o_cadastro_do_site.';

-- ── As cinco funções da fila ────────────────────────────────────────────────
-- Os corpos abaixo são os que estavam no banco, com UMA troca em cada: o
-- `exists` sobre atendente_candidatos virou a chamada acima. Nada mais mudou.
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
