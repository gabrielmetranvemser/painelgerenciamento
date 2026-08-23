-- =============================================================================
-- A mensagem de Saída precisa poder sair para quem acabou de ser bloqueado
-- =============================================================================
-- Conflito encontrado ao ligar as mensagens de seguimento no fluxo:
--
--   registrar_resultado('pediu_saida') cria o bloqueio NO MESMO COMMIT (certo:
--   não pode existir janela em que o contato foi marcado e ainda não está
--   bloqueado). Só que registrar_abertura recusa qualquer envio a quem está
--   bloqueado — então a mensagem de Saída, que é a confirmação educada de que
--   o número saiu da lista, ficava impossível de mandar.
--
-- A etapa 'saida' é a única exceção, e é a exceção certa: ela não oferece nada,
-- não tem link e não pede resposta. Ela informa que o pedido foi cumprido, que
-- é justamente o que a pessoa quer ouvir. Todas as outras etapas continuam
-- barradas — envio a quem pediu saída gera multa POR MENSAGEM.

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
  -- Bloqueado não recebe mensagem. Exceção única: a confirmação de saída.
  if p_etapa <> 'saida'
     and exists (select 1 from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_bloqueado');
  end if;
  -- Dado já apagado significa que não há mais para quem mandar.
  if v_contato.telefone_e164 is null then
    return jsonb_build_object('ok', false, 'motivo', 'dados_apagados');
  end if;

  select i.aberto_wa_em into v_antes
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa;

  insert into public.interacoes
    (contato_id, atendente_id, chip_id, etapa, variacao_id, texto_enviado,
     aberto_wa_em, dia_operacional)
  values
    (p_contato_id, v_uid, p_chip_id, p_etapa, p_variacao_id, p_texto, now(), v_hoje)
  on conflict (contato_id, etapa) do update
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

-- `preparar_mensagem` também precisa aceitar montar a Saída para quem já está
-- bloqueado — é a mesma exceção, do outro lado do fluxo.
