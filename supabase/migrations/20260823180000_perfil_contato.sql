-- =============================================================================
-- Perfil do contato: histórico, correção de resultado e pedido de kit
-- =============================================================================
-- O atendente marcava o resultado e perdia o contato de vista. Se a pessoa
-- respondesse depois, ou se ele clicasse no botão errado, não havia como
-- corrigir. Estas três funções resolvem isso sem abrir escrita direta em
-- `contatos` — o atendente continua sem UPDATE pelo RLS.

-- ── Histórico ───────────────────────────────────────────────────────────────
-- Junta interações e cliques. Existe como RPC porque `cliques` não tem policy
-- para atendente (e não deve ter: é tabela de escrita-servidor). Aqui ele vê
-- só os cliques dos PRÓPRIOS contatos.
create or replace function public.historico_contato(p_contato_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid uuid := (select auth.uid());
  v_contato public.contatos%rowtype;
begin
  select * into v_contato from public.contatos where id = p_contato_id;
  if v_contato.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if v_contato.atendente_id <> v_uid and not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;

  return jsonb_build_object(
    'ok', true,
    'interacoes', coalesce((
      select jsonb_agg(jsonb_build_object(
               'etapa', i.etapa,
               'aberto_wa_em', i.aberto_wa_em,
               'texto_enviado', i.texto_enviado,
               'resultado', i.resultado
             ) order by i.criado_em)
        from public.interacoes i
       where i.contato_id = p_contato_id and i.aberto_wa_em is not null
    ), '[]'::jsonb),
    -- Só clique de gente. O pré-carregamento do WhatsApp não conta, senão o
    -- atendente acharia que a pessoa abriu o material quando não abriu.
    'cliques', coalesce((
      select jsonb_agg(jsonb_build_object('destino', d.chave, 'quando', c.ts) order by c.ts)
        from public.cliques c
        join public.links l on l.token = c.token
        join public.destinos d on d.id = l.destino_id
       where l.contato_id = p_contato_id and c.is_bot = false
    ), '[]'::jsonb),
    'pedido_kit', (
      select jsonb_build_object('endereco', cap.endereco, 'itens', cap.itens, 'em', cap.criado_em)
        from public.captacoes cap
       where cap.contato_id = p_contato_id and cap.origem = 'kit'
       order by cap.criado_em desc limit 1
    )
  );
end;
$$;

-- ── Pedido de kit registrado pelo atendente ─────────────────────────────────
-- Durante a conversa a pessoa pede santinho ou adesivo. O atendente anota o
-- endereço aqui e o pedido cai no MESMO relatório que a equipe de entrega já
-- usa (Gestor → Relatórios → Pedidos de kit).
--
-- Guardado em `captacoes`, e não em colunas novas de `contatos`, porque é
-- exatamente a mesma coisa que o formulário /kit produz.
create or replace function public.registrar_pedido_kit(
  p_contato_id   uuid,
  p_endereco     text,
  p_itens        text[],
  p_municipio_id smallint default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_contato public.contatos%rowtype;
  v_id      uuid;
begin
  select * into v_contato from public.contatos where id = p_contato_id;
  if v_contato.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'nao_encontrado');
  end if;
  if v_contato.atendente_id <> v_uid and not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  if v_contato.anonimizado_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'dados_apagados');
  end if;
  if p_itens is null or cardinality(p_itens) = 0 then
    return jsonb_build_object('ok', false, 'motivo', 'sem_itens');
  end if;

  if p_municipio_id is not null then
    update public.contatos set municipio_id = p_municipio_id where id = p_contato_id;
  end if;

  select cap.id into v_id
    from public.captacoes cap
   where cap.contato_id = p_contato_id and cap.origem = 'kit'
   order by cap.criado_em desc limit 1;

  if v_id is null then
    insert into public.captacoes
      (origem, nome, telefone_e164, chave_dedup, municipio_id, endereco, itens,
       virou_contato, contato_id)
    values
      ('kit', v_contato.nome, v_contato.telefone_e164, v_contato.chave_dedup,
       coalesce(p_municipio_id, v_contato.municipio_id), p_endereco, p_itens,
       true, p_contato_id);
  else
    update public.captacoes
       set endereco = p_endereco,
           itens = p_itens,
           municipio_id = coalesce(p_municipio_id, municipio_id),
           nome = v_contato.nome,
           telefone_e164 = v_contato.telefone_e164
     where id = v_id;
  end if;

  return jsonb_build_object('ok', true);
end;
$$;

-- ── Corrigir o resultado ────────────────────────────────────────────────────
-- Substitui a versão anterior. Duas mudanças:
--
-- 1. Passa a permitir corrigir um resultado já marcado. Antes, quem clicasse
--    errado ou recebesse resposta dias depois ficava sem saída.
--
-- 2. Corrigir um "Pediu saída" REMOVE o bloqueio — mas só quando o bloqueio
--    veio do atendimento (origem 'pediu_saida'), nunca quando a própria pessoa
--    clicou em "não quero receber" na página do link (origem 'landing'). Um é
--    erro de digitação do atendente; o outro é a vontade da pessoa, e essa não
--    se desfaz por aqui. Toda correção desse tipo gera alerta para o gestor.
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

    delete from public.bloqueios
     where telefone_hmac = v_contato.telefone_hmac and origem = 'pediu_saida';

    insert into public.alertas (tipo, atendente_id, detalhe)
    values ('saida_corrigida', v_uid,
            'Um "Pediu saída" foi corrigido para "' || p_resultado ||
            '" e o bloqueio foi removido.');
  end if;

  update public.contatos
     set status          = p_resultado,
         resultado_em    = now(),
         claim_expira_em = null,
         municipio_id    = coalesce(p_municipio_id, municipio_id),
         encaminhamento  = coalesce(p_encaminhamento, encaminhamento)
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

revoke execute on function public.historico_contato(uuid) from anon, public;
revoke execute on function public.registrar_pedido_kit(uuid, text, text[], smallint) from anon, public;
grant  execute on function public.historico_contato(uuid) to authenticated;
grant  execute on function public.registrar_pedido_kit(uuid, text, text[], smallint) to authenticated;
