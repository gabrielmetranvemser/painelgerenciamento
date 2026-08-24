-- =============================================================================
-- Resultado: estado que faz sentido, correção com rastro, campo livre no lugar
-- =============================================================================
-- Três arestas do mesmo lugar, todas da auditoria.
--
-- 1. QUALQUER STATUS ACEITAVA QUALQUER RESULTADO. Um contato 'perdido' — cujo
--    chip caiu levando a conversa junto — podia receber "Autorizou" e voltar
--    para a conta de autorizações a partir de uma resposta que ninguém leu. Um
--    contato que voltou para a fila podia ter o desfecho decidido por quem não
--    o atende mais.
--
-- 2. TROCAR UM DESFECHO NÃO DEIXAVA RASTRO. Corrigir é legítimo e continua
--    permitido — a pessoa responde dias depois, o clique foi errado. O que não
--    podia continuar era acontecer em silêncio: o desfecho anterior sumia, e
--    quem olhasse o relatório mudando não tinha como entender por quê.
--
-- 3. O CAMPO LIVRE ERA GRAVADO EM TODO RESULTADO. Ele existe só para
--    "Encaminhar". Quem digitasse uma anotação e depois clicasse em "Pediu
--    saída" gravava texto livre na ficha de alguém que acabou de pedir para
--    sair — e este é o único campo de texto livre do sistema, ou seja, o único
--    lugar onde caberia por engano uma anotação que não pode existir.

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
begin
  if p_resultado not in ('autorizou','pediu_saida','invalido','quer_ajudar','encaminhado') then
    return jsonb_build_object('ok', false, 'motivo', 'resultado_invalido');
  end if;

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

  -- ── O contato precisa estar num estado em que um resultado signifique algo ──
  -- Antes, qualquer status aceitava qualquer resultado, e dois casos concretos
  -- passavam:
  --
  --   'perdido'  o chip caiu e a conversa foi junto — não há como saber o que a
  --              pessoa respondeu, porque a resposta chegou num número morto.
  --              Marcar "Autorizou" aqui ressuscitava o contato na conta de
  --              autorizações a partir de uma conversa que ninguém leu.
  --   'na_fila'  o contato voltou para a fila e pode estar na mão de outra
  --              pessoa. Quem atendeu antes não decide mais o desfecho dele.
  if v_contato.status in ('perdido', 'na_fila', 'novo') then
    return jsonb_build_object('ok', false, 'motivo', 'contato_fora_de_atendimento');
  end if;

  -- ── Correção de um "Pediu saída" ──────────────────────────────────────────
  if v_contato.status = 'pediu_saida' and p_resultado <> 'pediu_saida' then
    if v_contato.anonimizado_em is not null then
      -- Passados os 48h os dados já foram apagados. Não há o que restaurar.
      return jsonb_build_object('ok', false, 'motivo', 'dados_ja_apagados');
    end if;

    select b.origem into v_origem
      from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac;

    if v_origem = 'landing' then
      return jsonb_build_object('ok', false, 'motivo', 'saida_pedida_pela_pessoa');
    end if;

    -- ⚠️ AQUI O ATENDENTE PARA. Ver o cabeçalho desta migration: desfazer um
    -- pedido de saída é a única correção do sistema cujo erro custa multa por
    -- mensagem, e ela deixa de ser reversível por quem a cometeu.
    --
    -- O pedido de revisão vai para o gestor UMA vez: clicar de novo não enche a
    -- lista dele de avisos iguais sobre a mesma pessoa.
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
  -- Trocar "Autorizou" por "Número inválido" três dias depois é legítimo — a
  -- pessoa pode ter respondido, ou o clique pode ter sido errado. O que não
  -- pode é acontecer em silêncio: sem registro, o desfecho anterior some, e
  -- ninguém consegue olhar para trás e entender por que a conta do relatório
  -- mudou. É raro o bastante para virar alerta sem fazer barulho.
  if v_contato.status <> 'em_atendimento' and v_contato.status <> p_resultado then
    insert into public.alertas (tipo, atendente_id, contato_id, detalhe)
    values ('resultado_corrigido', v_uid, p_contato_id,
            'Um resultado já registrado foi trocado de "' || v_contato.status ||
            '" para "' || p_resultado || '".');
  end if;

  update public.contatos
     set status          = p_resultado,
         resultado_em    = now(),
         claim_expira_em = null,
         municipio_id    = coalesce(p_municipio_id, municipio_id),
         -- O campo livre só existe para "Encaminhar". A tela já não manda em
         -- outro resultado; o servidor recusa de todo jeito, porque é o único
         -- campo de texto livre do sistema e o único lugar onde caberia, por
         -- engano, uma anotação que não pode existir.
         encaminhamento  = case when p_resultado = 'encaminhado'
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

  return jsonb_build_object('ok', true, 'status', p_resultado);
end;
$$;
