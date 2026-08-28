-- =============================================================================
-- O gestor escreve mensagens próprias
-- =============================================================================
-- As sete etapas continuam sendo as sete etapas: são elas que sustentam as
-- travas, a rotação de variação por chip e a auditoria. O que faltava era o
-- gestor poder acrescentar textos que a operação usa e que não são nenhuma
-- delas — "estamos com carreata no sábado", "o material acabou, chega
-- terça" — sem depender do desenvolvedor.
--
-- ⚠️ POR QUE UMA TABELA NOVA, E NÃO UM VALOR DE ENUM POR TEXTO.
--
-- `etapa_msg` entra em índice único (`interacoes (contato_id, etapa,
-- candidato_id)`), em `etapa_de_abordagem()`, em `etapa_por_candidato()` e nas
-- travas de `preparar_mensagem`. Um valor novo de enum a cada texto que alguém
-- escreve faria a espinha do sistema crescer com o improviso do dia. Todos os
-- livres compartilham a etiqueta `livre`, e QUAL deles é uma coluna.

create table if not exists public.modelos_livres (
  id        uuid primary key default gen_random_uuid(),
  nome      text not null check (length(btrim(nome)) between 2 and 60),
  /** A linha embaixo do botão, na tela do atendente. */
  dica      text check (dica is null or length(dica) <= 120),
  texto     text not null check (length(btrim(texto)) between 2 and 2000),

  /**
   * Conta como abordagem — ou seja, respeita o intervalo entre mensagens.
   *
   * ⚠️ O PADRÃO É `true`, e a escolha do padrão é a decisão inteira. Uma
   * mensagem livre marcada como "resposta" não espera o intervalo; se todas
   * nascessem assim, elas virariam a porta de fuga da trava que existe para o
   * número do atendente não cair. Quem sabe que aquele texto é resposta a quem
   * acabou de escrever é o gestor, e ele desmarca.
   */
  e_abordagem boolean not null default true,

  ordem     int not null default 0,
  ativo     boolean not null default true,
  criado_em timestamptz not null default now(),
  atualizado_em timestamptz not null default now()
);

create index if not exists modelos_livres_ativos_idx
  on public.modelos_livres (ordem, nome) where ativo;

alter table public.modelos_livres enable row level security;

create policy modelos_livres_leitura on public.modelos_livres
  for select to authenticated using (public.sou_ativo());
create policy modelos_livres_gestor on public.modelos_livres
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- A tabela dos sete fixos não recebe linha nova — é o que torna honesto o tipo
-- `EtapaFixa` do TypeScript, e o que impede alguém de "resolver" o problema
-- criando uma oitava etapa à mão.
alter table public.modelos
  drop constraint if exists modelos_etapa_nao_livre;
alter table public.modelos
  add constraint modelos_etapa_nao_livre check (etapa <> 'livre');

-- ── Qual modelo livre gerou a interação ─────────────────────────────────────
alter table public.interacoes
  add column if not exists modelo_livre_id uuid references public.modelos_livres(id);

comment on column public.interacoes.modelo_livre_id is
  'Qual mensagem do gestor foi enviada, quando a etapa é `livre`. Nulo nas sete '
  'etapas fixas.';

/**
 * ⚠️ O ÍNDICE ÚNICO DAS INTERAÇÕES PRECISA CONHECER O MODELO LIVRE.
 *
 * `interacoes` tem um índice único em `(contato_id, etapa, candidato_id)` com
 * `NULLS NOT DISTINCT`, e é ele que torna "Abrir conversa" idempotente: duplo
 * clique não conta duas vezes. Os `on conflict` de `preparar_mensagem` e
 * `registrar_abertura` apontam para exatamente essas três colunas.
 *
 * Com todos os textos do gestor compartilhando a etapa `livre`, esse índice
 * passaria a dizer "uma mensagem livre por contato, para sempre": mandar a
 * segunda colidiria com a primeira, e o `do update` sobrescreveria o registro
 * dela — apagando prova de auditoria.
 *
 * A saída é ACRESCENTAR `modelo_livre_id` ao mesmo índice, e não trocá-lo por
 * índices parciais. Índice parcial exigiria um `where` em cada `on conflict`, e
 * um `on conflict` que não casa com índice nenhum não falha no `db push`: falha
 * em produção, na primeira conversa do dia.
 *
 * Para as sete etapas fixas nada muda — lá `modelo_livre_id` é sempre nulo, e
 * `NULLS NOT DISTINCT` faz o par se comportar exatamente como antes.
 */
drop index if exists public.interacoes_contato_etapa_candidato_uk;

create unique index interacoes_contato_etapa_candidato_uk
  on public.interacoes (contato_id, etapa, candidato_id, modelo_livre_id)
  nulls not distinct;

/**
 * Esta mensagem conta como abordagem?
 *
 * As sete fixas respondem pela etapa, como sempre. A livre responde pelo que o
 * gestor marcou no modelo — e o padrão de lá é `true`, para uma mensagem livre
 * não virar a porta de fuga do intervalo entre abordagens.
 *
 * `stable`, e não `immutable`: lê a tabela.
 */
create or replace function public.interacao_de_abordagem(
  p_etapa           public.etapa_msg,
  p_modelo_livre_id uuid
)
returns boolean
language sql stable
as $$
  select case
    when p_etapa <> 'livre' then public.etapa_de_abordagem(p_etapa)
    else coalesce(
      (select ml.e_abordagem from public.modelos_livres ml where ml.id = p_modelo_livre_id),
      -- Modelo apagado depois do envio: conta como abordagem. Na dúvida, o
      -- lado seguro é o que protege o número do atendente.
      true
    )
  end;
$$;


-- ═══════════════════════════════════════════════════════════════════════════
-- As quatro funções que precisam conhecer o modelo livre
-- ═══════════════════════════════════════════════════════════════════════════
-- Vêm INTEIRAS da versão anterior, com as mudanças pontuais marcadas em
-- comentário. Vêm inteiras porque `create or replace function` substitui o
-- corpo todo — não existe alterar uma linha de uma função no Postgres.

-- ── preparar_mensagem: ganha o caminho da mensagem livre ────────────────────
CREATE OR REPLACE FUNCTION public.preparar_mensagem(p_contato_id uuid, p_chip_id uuid, p_etapa etapa_msg, p_candidato_id uuid DEFAULT NULL::uuid, p_modelo_livre_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
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
  v_livre     public.modelos_livres%rowtype;
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

  -- ── Mensagem escrita pelo gestor ─────────────────────────────────────────
  -- Caminho próprio: os livres não têm variação nem rotação por chip. São um
  -- texto só, e a rotação existe para o WhatsApp não ver a MESMA frase saindo
  -- do mesmo número trinta vezes na abordagem — que é outro problema.
  --
  -- Passa pelas mesmas travas de cima (chip, horário, dia bloqueado, bloqueio
  -- da pessoa, contato é seu): elas já rodaram antes de chegar aqui.
  if p_etapa = 'livre' then
    if p_modelo_livre_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'modelo_obrigatorio');
    end if;

    select * into v_livre
      from public.modelos_livres where id = p_modelo_livre_id and ativo;

    if v_livre.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'modelo_ausente');
    end if;

    insert into public.interacoes
      (contato_id, atendente_id, chip_id, etapa, candidato_id, modelo_livre_id,
       dia_operacional)
    values
      (p_contato_id, v_uid, p_chip_id, 'livre', null, p_modelo_livre_id,
       public.hoje_operacional())
    on conflict (contato_id, etapa, candidato_id, modelo_livre_id) do update
      set atendente_id = case when interacoes.aberto_wa_em is null
                              then excluded.atendente_id else interacoes.atendente_id end,
          chip_id      = case when interacoes.aberto_wa_em is null
                              then excluded.chip_id else interacoes.chip_id end,
          dia_operacional = case when interacoes.aberto_wa_em is null
                                 then excluded.dia_operacional else interacoes.dia_operacional end;

    return jsonb_build_object(
      'ok', true,
      'etapa', 'livre',
      'modelo_livre_id', v_livre.id,
      -- Sem variação: `variacao_id` fica nulo, e quem chama repassa nulo.
      'variacao_id', null,
      'modelo', v_livre.texto,
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
      'candidato', null,
      'materiais', '[]'::jsonb,
      'pagina_token', null
    );
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
    on conflict (contato_id, etapa, candidato_id, modelo_livre_id) do update
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
$function$;

-- ── registrar_abertura: a abertura sabe QUAL mensagem foi ───────────────────
CREATE OR REPLACE FUNCTION public.registrar_abertura(p_contato_id uuid, p_chip_id uuid, p_etapa etapa_msg, p_texto text DEFAULT NULL::text, p_variacao_id uuid DEFAULT NULL::uuid, p_candidato_id uuid DEFAULT NULL::uuid, p_modelo_livre_id uuid DEFAULT NULL::uuid)
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

    if not v_ja_conta and coalesce(v_enviados, 0) >= v_rampa.teto then
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
          return jsonb_build_object(
            'ok', false, 'motivo', 'intervalo', 'segundos_espera', v_espera
          );
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

  return jsonb_build_object(
    'ok', true,
    'ja_registrado', v_antes is not null,
    'interacao_id', v_id,
    'candidatos_declarados', v_declarados,
    'fila', public.fila_status(p_chip_id)
  );
end;
$function$;

-- ── gravar_texto_preparado: o rascunho certo ────────────────────────────────
CREATE OR REPLACE FUNCTION public.gravar_texto_preparado(p_contato_id uuid, p_etapa etapa_msg, p_candidato_id uuid, p_texto text, p_modelo_livre_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_uid     uuid := (select auth.uid());
  v_contato public.contatos%rowtype;
begin
  select * into v_contato from public.contatos where id = p_contato_id;
  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;

  update public.interacoes
     set texto_enviado = p_texto
   where contato_id = p_contato_id
     and etapa = p_etapa
     and candidato_id is not distinct from p_candidato_id
     -- Sem isto, gravar o texto da segunda mensagem livre sobrescreveria o
     -- rascunho da primeira: as duas têm a mesma etapa e o mesmo candidato nulo.
     and modelo_livre_id is not distinct from p_modelo_livre_id
     -- Só rascunho. Texto de conversa já aberta é registro, não campo.
     and aberto_wa_em is null;

  return jsonb_build_object('ok', true);
end;
$function$;

-- ── fila_status: o intervalo pergunta ao modelo ─────────────────────────────
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
