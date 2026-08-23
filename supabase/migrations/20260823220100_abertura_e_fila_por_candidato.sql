-- =============================================================================
-- Abertura por candidato, congelamento do consentimento e roteamento da fila
-- =============================================================================

create or replace function public.registrar_abertura(
  p_contato_id   uuid,
  p_chip_id      uuid,
  p_etapa        public.etapa_msg,
  p_texto        text default null,
  p_variacao_id  uuid default null,
  p_candidato_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_cfg       public.config%rowtype;
  v_hoje      date := public.hoje_operacional();
  v_hora      int  := public.hora_local();
  v_chip      public.chips%rowtype;
  v_contato   public.contatos%rowtype;
  v_antes     timestamptz;
  v_id        uuid;
  v_declarados int := 0;
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
  if v_chip.status in ('pausado', 'morto') then
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

  select i.aberto_wa_em into v_antes
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa
     and i.candidato_id is not distinct from p_candidato_id;

  insert into public.interacoes
    (contato_id, atendente_id, chip_id, etapa, candidato_id, variacao_id,
     texto_enviado, aberto_wa_em, dia_operacional)
  values
    (p_contato_id, v_uid, p_chip_id, p_etapa, p_candidato_id, p_variacao_id,
     p_texto, now(), v_hoje)
  on conflict (contato_id, etapa, candidato_id) do update
     -- coalesce em todos: a primeira gravação de cada campo é a que vale.
     set aberto_wa_em  = coalesce(interacoes.aberto_wa_em, excluded.aberto_wa_em),
         texto_enviado = coalesce(interacoes.texto_enviado, excluded.texto_enviado),
         variacao_id   = coalesce(interacoes.variacao_id, excluded.variacao_id),
         chip_id       = coalesce(interacoes.chip_id, excluded.chip_id)
  returning id into v_id;

  -- ── O CONGELAMENTO DO CONSENTIMENTO ──────────────────────────────────────
  -- No instante em que a permissão é enviada, grava-se quais candidatos foram
  -- declarados àquela pessoa. É isso que a resposta dela cobre.
  --
  -- Um candidato acrescentado à chapa DEPOIS não entra aqui, e por isso não
  -- alcança quem já autorizou: precisaria de nova permissão. Sem esta trava, o
  -- gestor conseguiria fazer propaganda para uma base inteira sem que ninguém
  -- tivesse consentido com aquela candidatura.
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

  -- Material enviado: marca na trilha.
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

  return jsonb_build_object(
    'ok', true,
    'ja_registrado', v_antes is not null,
    'interacao_id', v_id,
    'candidatos_declarados', v_declarados,
    'fila', public.fila_status(p_chip_id)
  );
end;
$$;

drop function if exists public.registrar_abertura(uuid, uuid, public.etapa_msg, text, uuid);

-- ── A fila respeita de quem é o lead ───────────────────────────────────────
-- Um contato captado pela página do Fulano só é entregue a quem atende o
-- Fulano. Entregar a outro atendente significaria mandar material de uma chapa
-- que a pessoa não pediu — e o consentimento que ela deu foi ao Fulano.
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

  -- 1. Já tem contato na mão? Devolve o mesmo.
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
     -- Lead de candidato só vai para quem atende aquele candidato.
     and (
       c.candidato_origem_id is null
       or exists (
         select 1 from public.atendente_candidatos ac
          where ac.atendente_id = v_uid and ac.candidato_id = c.candidato_origem_id
       )
     )
   order by
     (c.atendente_id = v_uid) desc nulls last,
     -- QUENTE antes de FRIO (docs/01-VISAO-GERAL.md §4).
     (c.origem = 'lista_fria'),
     c.criado_em
   for update skip locked
   limit 1;

  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'fila_vazia', 'fila', v_status);
  end if;

  update public.contatos
     set status='em_atendimento', atendente_id=v_uid, chip_id=p_chip_id,
         claimed_at=now(),
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

-- ── Quantos leads não têm quem atenda ──────────────────────────────────────
-- Lead de candidato sem nenhum atendente na chapa fica parado para sempre e
-- ninguém percebe. O gestor precisa enxergar isso.
create or replace view public.v_leads_orfaos with (security_invoker = on) as
select c.id as candidato_id, c.nome_urna, c.slug, count(ct.id) as na_fila
  from public.candidatos c
  join public.contatos ct on ct.candidato_origem_id = c.id and ct.status = 'na_fila'
 where not exists (
   select 1 from public.atendente_candidatos ac
     join public.usuarios u on u.id = ac.atendente_id
    where ac.candidato_id = c.id and u.ativo
 )
 group by c.id, c.nome_urna, c.slug;
