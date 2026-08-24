-- =============================================================================
-- Desfazer um "Pediu saída" deixa de ser coisa do atendente
-- =============================================================================
-- ⚠️ Qualquer atendente apagava um bloqueio sozinho, e o sistema só avisava
--    DEPOIS.
--
-- Corrigir o resultado de um contato que estava em 'pediu_saida' apagava a linha
-- de `bloqueios` e liberava o envio de novo. Bastava marcar "Autorizou" por
-- cima. O alerta ao gestor nascia junto — mas nascia como aviso do que já tinha
-- acontecido, não como pergunta antes de acontecer.
--
-- Isso contradiz a regra que passou a valer no formulário público (migration
-- 330000): cadastro não desfaz bloqueio, e quem libera é o gestor, à mão, com
-- registro. Não faz sentido a porta da frente estar trancada e a de dentro não.
--
-- O CASO REAL QUE ISTO PRECISA CONTINUAR RESOLVENDO é o clique errado: a tecla
-- "2" marca "Pediu saída", e é fácil apertar sem querer. A pessoa não pode ficar
-- bloqueada para sempre por causa disso.
--
-- Então o caminho existe, só que passa pelo gestor:
--
--   1. o atendente tenta corrigir → recusado, com a frase certa na tela;
--   2. nasce um alerta com o contato em anexo (uma vez, não um por clique);
--   3. o gestor clica em "Liberar" na tela de Suporte;
--   4. o bloqueio some, o contato volta para o MESMO atendente, em atendimento,
--      com reserva nova — a conversa continua de onde parou, sem passar pela
--      fila e sem outra pessoa reabordar quem já foi abordado.
--
-- Saída pedida pela própria pessoa, pelo link ('landing'), continua sem volta
-- nenhuma — nem por aqui, nem pelo gestor.

-- `alertas` ganha o contato: sem ele, "um atendente marcou saída por engano"
-- seria um texto solto, e o gestor não teria em quem clicar.
alter table public.alertas
  add column if not exists contato_id uuid references public.contatos(id) on delete set null;

create index if not exists alertas_contato_idx on public.alertas (contato_id)
  where contato_id is not null;

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
