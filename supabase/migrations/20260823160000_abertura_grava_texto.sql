-- =============================================================================
-- registrar_abertura: preservar o texto e acertar a idempotência
-- =============================================================================
-- Dois defeitos encontrados no teste ponta a ponta:
--
-- 1. `preparar_mensagem` cria a interação antes (para fixar a variação), e o
--    ON CONFLICT do `registrar_abertura` só tocava em `aberto_wa_em`. Resultado:
--    `texto_enviado` ficava nulo e o log de auditoria — que é a prova de o que
--    exatamente foi mandado para cada pessoa — perdia justamente o texto.
--
-- 2. `ja_registrado` saía de `xmax <> 0`, que é verdadeiro sempre que houve
--    conflito. Como a linha já existia por causa do item 1, a PRIMEIRA abertura
--    também se declarava repetida. Agora olha o valor anterior de aberto_wa_em,
--    que é o que a pergunta realmente significa.

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
  v_antes   timestamptz;
  v_id      uuid;
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
  if exists (select 1 from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_bloqueado');
  end if;

  -- Estado ANTES da gravação: é isto que responde "já tinha aberto?".
  select i.aberto_wa_em into v_antes
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa;

  insert into public.interacoes
    (contato_id, atendente_id, chip_id, etapa, variacao_id, texto_enviado,
     aberto_wa_em, dia_operacional)
  values
    (p_contato_id, v_uid, p_chip_id, p_etapa, p_variacao_id, p_texto,
     now(), v_hoje)
  on conflict (contato_id, etapa) do update
     -- coalesce em todos: a primeira gravação de cada campo é a que vale.
     -- Duplo clique não muda horário, nem texto, nem variação.
     set aberto_wa_em  = coalesce(interacoes.aberto_wa_em, excluded.aberto_wa_em),
         texto_enviado = coalesce(interacoes.texto_enviado, excluded.texto_enviado),
         variacao_id   = coalesce(interacoes.variacao_id, excluded.variacao_id),
         chip_id       = coalesce(interacoes.chip_id, excluded.chip_id)
  returning id into v_id;

  update public.contatos
     set primeiro_contato_em = coalesce(primeiro_contato_em, now()),
         chip_id = coalesce(chip_id, p_chip_id)
   where id = p_contato_id;

  return jsonb_build_object(
    'ok', true,
    'ja_registrado', v_antes is not null,
    'interacao_id', v_id,
    'fila', public.fila_status(p_chip_id)
  );
end;
$$;
