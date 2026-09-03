-- =============================================================================
-- "Autorizou" libera o material na hora, mesmo sem a Permissão ter saído
-- =============================================================================
-- Pedido de quem opera: "quando clicar no autorizou, já libera o material,
-- independente do usuário ir até a etapa 3 - Permissão".
--
-- Até aqui, `contato_candidato` — a lista de quem foi declarado àquela pessoa —
-- só era preenchida no envio da mensagem de PERMISSÃO. Fazia sentido quando a
-- permissão era a primeira mensagem e o caminho era um só. Deixou de fazer
-- quando a conversa virou quatro passos e ganhou "pular etapa": o atendente que
-- conhece a pessoa manda o "oi", ela responde "pode mandar", ele marca
-- Autorizou — e a ficha dizia "nenhum candidato liberado para esta pessoa
-- ainda".
--
-- ⚠️ ISTO MEXE NO CONGELAMENTO DO CONSENTIMENTO, e é por isso que a marca
--    importa mais que o recurso.
--
-- `contato_candidato` responde a uma pergunta jurídica: quais candidatos esta
-- pessoa sabia que ia receber quando disse "pode". Havia uma única resposta
-- possível — "os que estavam escritos na mensagem de permissão" —, e agora há
-- duas. A segunda é "os que o atendente atendia quando marcou Autorizou".
--
-- As duas são registradas, e `declarado_em_reparo` as separa:
--
--     false → a chapa foi declarada POR ESCRITO, na mensagem de permissão
--     true  → foi declarada por um ato: o atendente marcando o desfecho, ou o
--             gestor consertando um contato órfão depois
--
-- É a mesma marca que `declarar_candidatos_pendentes` já usava. Ela existe para
-- o dia em que alguém precisar olhar para trás e entender de onde veio a
-- autorização daquela pessoa — e esse dia é o da denúncia, não o de hoje.
--
-- O que NÃO muda: `registrar_resultado` continua recusando desfecho sem nenhuma
-- mensagem enviada (`conversa_nao_aberta`). Ninguém "autoriza" alguém com quem
-- não falou.

create or replace function public.registrar_resultado(p_contato_id uuid, p_resultado status_contato, p_municipio_id smallint DEFAULT NULL::smallint, p_encaminhamento text DEFAULT NULL::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  v_declarados int := 0;
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

  -- ── "Autorizou" libera o material, mesmo sem a Permissão ter saído ───────
  --
  -- ⚠️ Aqui o consentimento é congelado por um ATO DO ATENDENTE, e não por uma
  -- mensagem. Ver o cabeçalho desta migration.
  --
  -- `declarado_em_reparo = true` é o que mantém isso honesto: a linha diz, para
  -- sempre, que estes candidatos NÃO foram declarados pela mensagem de
  -- permissão. É a mesma marca que `declarar_candidatos_pendentes` usa quando o
  -- gestor conserta contato órfão, e ela existe justamente para o dia em que
  -- alguém precisar olhar para trás e entender de onde veio a autorização.
  --
  -- Só entra o que FALTA: se a permissão saiu, a chapa já está lá com a marca
  -- limpa, e o `on conflict do nothing` não a suja.
  if p_resultado = 'autorizou' then
    with declarados as (
      insert into public.contato_candidato
        (contato_id, candidato_id, atendente_id, chip_id, declarado_em_reparo)
      select p_contato_id, ch.candidato_id, v_uid, v_contato.chip_id, true
        from public.chapa_do_atendente(v_uid) ch
      on conflict (contato_id, candidato_id) do nothing
      returning 1
    ) select count(*)::int into v_declarados from declarados;
  end if;

  if p_resultado = 'pediu_saida' then
    insert into public.bloqueios (telefone_hmac, hmac_versao, motivo, origem, contato_id, apagar_em)
    values (v_contato.telefone_hmac, v_contato.hmac_versao, 'Pediu saída no atendimento',
            'pediu_saida', p_contato_id, now() + interval '48 hours')
    on conflict (telefone_hmac) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true,
    'status', p_resultado,
    -- Quantos candidatos a tela pode oferecer agora. Zero em "Autorizou"
    -- significa atendente sem chapa, e a tela diz isso com todas as letras.
    'candidatos_declarados', v_declarados,
    'volta_em', case when p_resultado = 'falar_depois' then now() + interval '1 day' end
  );
end;
$function$;
