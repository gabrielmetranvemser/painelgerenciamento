-- =============================================================================
-- Apagar uma lista — com a única regra que impede isso de virar estrago
-- =============================================================================
-- Pedido do gestor: a base acumulou listas de teste, importações repetidas e
-- seis listas chamadas "excluir". Pausar tira da fila mas continua ocupando a
-- tela, e não há por que guardar uma planilha que nunca chegou a ninguém.
--
-- ⚠️ APAGAR A LISTA SOZINHA SERIA PIOR QUE NÃO TER O BOTÃO.
--
-- `contatos.lista_id` é `on delete set null`, e `lista_id is null` tem
-- significado próprio na fila: é "cadastrou-se sozinho", e cai para TODO
-- atendente. Um `delete from listas` puro e simples despejaria os contatos
-- daquela lista na fila de todo mundo de uma vez — o oposto do que o gestor
-- quis dizer com "apagar". Por isso quem apaga é esta função, e não a tela.
--
-- ── A REGRA ────────────────────────────────────────────────────────────────
--
--   nenhum contato abordado  → apaga a lista E os contatos dela
--   algum contato abordado   → RECUSA, e manda pausar
--
-- Contato abordado tem histórico em `interacoes`, e a lista é a PROCEDÊNCIA
-- dele — de quem veio e quando, que é exigência jurídica para lista fria
-- (docs/01-VISAO-GERAL.md §9.1). Apagar isso é apagar a defesa da campanha
-- sobre uma pessoa com quem ela realmente falou. Pausar já existe, tira da fila
-- na hora e não perde nada.
--
-- ── O QUE SOBREVIVE AO APAGAMENTO ──────────────────────────────────────────
--
-- `bloqueios.contato_id` é `on delete set null` de propósito: a lista de quem
-- pediu saída é por HMAC do telefone e NÃO pode sumir junto com o contato. Se
-- sumisse, o mesmo número voltaria numa importação futura — e mensagem para
-- quem pediu saída é multa por mensagem. Conferido antes de escrever isto.

create or replace function public.apagar_lista(
  p_lista_id  uuid,
  p_confirmar boolean default false
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_lista     public.listas%rowtype;
  v_total     int;
  v_abordados int;
  v_na_mao    int;
  v_apagados  int;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'somente_gestor');
  end if;

  select * into v_lista from public.listas where id = p_lista_id;
  if v_lista.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'lista_nao_existe');
  end if;

  select count(*)::int into v_total
    from public.contatos c where c.lista_id = p_lista_id;

  select count(*)::int into v_abordados
    from public.contatos c
   where c.lista_id = p_lista_id
     and exists (select 1 from public.interacoes i
                  where i.contato_id = c.id and i.aberto_wa_em is not null);

  -- Alguém já falou com essa gente: a lista virou histórico.
  if v_abordados > 0 then
    return jsonb_build_object(
      'ok', false, 'motivo', 'tem_historico',
      'total', v_total, 'abordados', v_abordados, 'rotulo', v_lista.rotulo
    );
  end if;

  -- Contato na mão de alguém AGORA. Ninguém tem a conversa aberta ainda (não há
  -- abordados), mas puxar a ficha da tela de um atendente no meio do clique é o
  -- tipo de coisa que ele reporta como "o painel bugou".
  select count(*)::int into v_na_mao
    from public.contatos c
   where c.lista_id = p_lista_id
     and c.status = 'em_atendimento'
     and c.claim_expira_em > now();

  if v_na_mao > 0 then
    return jsonb_build_object(
      'ok', false, 'motivo', 'contato_em_atendimento',
      'na_mao', v_na_mao, 'rotulo', v_lista.rotulo
    );
  end if;

  -- Segunda volta: a tela precisa dizer quantos contatos vão junto ANTES de
  -- apagar. Lista vazia não pede confirmação — não há o que confirmar.
  if v_total > 0 and not p_confirmar then
    return jsonb_build_object(
      'ok', false, 'motivo', 'precisa_confirmar',
      'total', v_total, 'rotulo', v_lista.rotulo
    );
  end if;

  -- `interacoes`, `links`, `contato_candidato` e `contato_correcoes` caem por
  -- cascata; `bloqueios`, `captacoes`, `alertas` e `chamados` ficam, com a
  -- referência nula. É a divisão certa: o que é rascunho vai, o que é prova
  -- fica.
  with fora as (
    delete from public.contatos where lista_id = p_lista_id returning 1
  ) select count(*)::int into v_apagados from fora;

  delete from public.listas where id = p_lista_id;

  return jsonb_build_object(
    'ok', true,
    'rotulo', v_lista.rotulo,
    'contatos_apagados', v_apagados
  );
end;
$$;

revoke execute on function public.apagar_lista(uuid, boolean) from anon, public;
grant  execute on function public.apagar_lista(uuid, boolean) to authenticated;
