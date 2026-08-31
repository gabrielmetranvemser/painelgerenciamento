-- Reimportar uma lista: move a pessoa, atualiza os dados, preserva o histórico.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ ESTE ARQUIVO EXISTE PORQUE A REGRA ANTIGA PAROU A OPERAÇÃO. Número que já
-- existia era ignorado em silêncio; a lista nova nascia vazia; o gestor
-- desativava a antiga; o atendente ficava sem fila. Ver o cabeçalho da
-- migration `reimportar_atualiza_sem_perder_historico`.
--
-- Os testes 5 a 9 são os que interessam de verdade: são as pessoas que NÃO
-- podem ser mexidas. Cada um deles, se cair, é dano real — mensagem para quem
-- pediu saída (multa por mensagem), contato roubado da mão de um atendente, ou
-- telefone apagado pela LGPD ressuscitado por uma planilha antiga.
begin;

do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_chip    uuid;
  v_cand    uuid;
  v_velha   uuid;
  v_nova    uuid;
  v_novo    uuid;   -- nunca existiu
  v_fila    uuid;   -- existe, na fila, nunca abordado
  v_falado  uuid;   -- existe, já abordado e com desfecho
  v_saiu    uuid;   -- pediu saída
  v_mao     uuid;   -- em atendimento agora
  v_perdido uuid;   -- chip morreu com ele
  v_apagado uuid;   -- telefone apagado pela purga
  v_r       jsonb;
  v_falhas  int := 0;
  v_st      text;
  v_lista   uuid;
  v_nome    text;
begin
  raise notice '── Reimportação ─────────────────────────────────────────────────────────';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    'reimp@painel.local', extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', '');
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'Reimp', true, now());
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Reimp', 'ativo', 'ativo') returning id into v_chip;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-reimp', 'Cand Reimp', 'deputado_federal', 1, '9971', 'RO', true)
  returning id into v_cand;

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Reimp velha', 'F', current_date) returning id into v_velha;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Reimp nova', 'F', current_date) returning id into v_nova;

  -- ── A base de antes ──────────────────────────────────────────────────────
  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
    chave_dedup, telefone_hmac, status)
  values (v_velha, 'lista_fria', 'JOSE DA SILVA', 'Jose', '5569230000601',
          '6923000601', 'hmac-reimp-601', 'na_fila')
  returning id into v_fila;

  -- Já abordado e com desfecho: a lista muda, o desfecho não.
  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
    chave_dedup, telefone_hmac, status, resultado_em)
  values (v_velha, 'lista_fria', 'Maria', 'Maria', '5569230000602',
          '6923000602', 'hmac-reimp-602', 'autorizou', now())
  returning id into v_falado;
  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa,
    dia_operacional, aberto_wa_em, texto_enviado)
  values (v_falado, v_uid, v_chip, 'permissao', public.hoje_operacional(), now(), 'oi maria');

  -- Pediu saída — e o bloqueio junto, como o sistema faz.
  insert into public.contatos (lista_id, origem, nome, telefone_e164,
    chave_dedup, telefone_hmac, status, resultado_em)
  values (v_velha, 'lista_fria', 'Saiu', '5569230000603',
          '6923000603', 'hmac-reimp-603', 'pediu_saida', now())
  returning id into v_saiu;
  insert into public.bloqueios (telefone_hmac, hmac_versao, motivo, origem, contato_id, apagar_em)
  values ('hmac-reimp-603', 1, 'Pediu saída no atendimento', 'pediu_saida', v_saiu,
          now() + interval '48 hours');

  -- Na mão de alguém AGORA.
  insert into public.contatos (lista_id, origem, nome, telefone_e164,
    chave_dedup, telefone_hmac, status, atendente_id, chip_id, claimed_at, claim_expira_em)
  values (v_velha, 'lista_fria', 'Na mao', '5569230000604',
          '6923000604', 'hmac-reimp-604', 'em_atendimento', v_uid, v_chip,
          now(), now() + interval '10 min')
  returning id into v_mao;

  -- Perdido com o chip morto.
  insert into public.contatos (lista_id, origem, nome, telefone_e164,
    chave_dedup, telefone_hmac, status, resultado_em)
  values (v_velha, 'lista_fria', 'Perdido', '5569230000605',
          '6923000605', 'hmac-reimp-605', 'perdido', now())
  returning id into v_perdido;

  -- Telefone já apagado pela purga da LGPD.
  insert into public.contatos (lista_id, origem, nome, telefone_e164,
    chave_dedup, telefone_hmac, status)
  values (v_velha, 'lista_fria', null, null,
          '6923000606', 'hmac-reimp-606', 'invalido')
  returning id into v_apagado;

  -- ── A planilha nova: os seis de cima + um inédito ────────────────────────
  v_r := public.importar_contatos(v_nova, 'lista_fria', jsonb_build_array(
    jsonb_build_object('nome','José da Silva','primeiro_nome','José','e164','5569230000601',
                       'chave_dedup','6923000601','hmac','hmac-reimp-601','hmac_versao',1),
    -- Nome VAZIO na planilha nova: não pode apagar o nome que já existe.
    jsonb_build_object('nome','','primeiro_nome',null,'e164','5569230000602',
                       'chave_dedup','6923000602','hmac','hmac-reimp-602','hmac_versao',1),
    jsonb_build_object('nome','Saiu','primeiro_nome','Saiu','e164','5569230000603',
                       'chave_dedup','6923000603','hmac','hmac-reimp-603','hmac_versao',1),
    jsonb_build_object('nome','Na mao','primeiro_nome','Na','e164','5569230000604',
                       'chave_dedup','6923000604','hmac','hmac-reimp-604','hmac_versao',1),
    jsonb_build_object('nome','Perdido','primeiro_nome','Perdido','e164','5569230000605',
                       'chave_dedup','6923000605','hmac','hmac-reimp-605','hmac_versao',1),
    jsonb_build_object('nome','Apagado','primeiro_nome','Apagado','e164','5569230000606',
                       'chave_dedup','6923000606','hmac','hmac-reimp-606','hmac_versao',1),
    jsonb_build_object('nome','Ines Nova','primeiro_nome','Ines','e164','5569230000607',
                       'chave_dedup','6923000607','hmac','hmac-reimp-607','hmac_versao',1)
  ));

  raise notice '  resultado: %', v_r;

  -- =========================================================================
  if (v_r->>'novos')::int = 1 and (v_r->>'atualizados')::int = 5
     and (v_r->>'bloqueados')::int = 1 then
    raise notice '  ✅ 1. 1 pessoa nova, 5 atualizadas, 1 bloqueada fora';
  else raise warning '  ❌ 1. contagem: %', v_r; v_falhas := v_falhas + 1;
  end if;

  select id into v_novo from public.contatos where telefone_hmac = 'hmac-reimp-607';
  if v_novo is not null then
    raise notice '  ✅ 2. a pessoa inédita entrou';
  else raise warning '  ❌ 2. a inédita não entrou'; v_falhas := v_falhas + 1;
  end if;

  -- ── Quem ainda não tinha sido abordado ────────────────────────────────────
  select lista_id, nome, status into v_lista, v_nome, v_st
    from public.contatos where id = v_fila;
  if v_lista = v_nova and v_nome = 'José da Silva' and v_st = 'na_fila' then
    raise notice '  ✅ 3. quem estava na fila mudou de lista e teve o nome corrigido';
  else raise warning '  ❌ 3. lista=% nome=% status=%', v_lista, v_nome, v_st; v_falhas := v_falhas + 1;
  end if;

  -- ── Quem já foi abordado: muda de lista, NÃO muda de desfecho ────────────
  select lista_id, nome, status into v_lista, v_nome, v_st
    from public.contatos where id = v_falado;
  if v_lista = v_nova and v_st = 'autorizou' then
    raise notice '  ✅ 4. quem já foi abordado mudou de lista e manteve o desfecho';
  else raise warning '  ❌ 4. lista=% status=%', v_lista, v_st; v_falhas := v_falhas + 1;
  end if;

  if v_nome = 'Maria' then
    raise notice '  ✅ 5. nome vazio na planilha não apagou o nome que já existia';
  else raise warning '  ❌ 5. nome virou "%"', v_nome; v_falhas := v_falhas + 1;
  end if;

  if exists (select 1 from public.interacoes where contato_id = v_falado
             and texto_enviado = 'oi maria') then
    raise notice '  ✅ 6. o histórico de atendimento continuou apontando para a pessoa';
  else raise warning '  ❌ 6. o histórico se perdeu'; v_falhas := v_falhas + 1;
  end if;

  -- ── Os intocáveis ────────────────────────────────────────────────────────
  select lista_id, status into v_lista, v_st from public.contatos where id = v_saiu;
  if v_lista = v_velha and v_st = 'pediu_saida' then
    raise notice '  ✅ 7. quem pediu saída não foi tocado — nem de lista mudou';
  else raise warning '  ❌ 7. MEXEU EM QUEM PEDIU SAÍDA: lista=% status=%', v_lista, v_st;
       v_falhas := v_falhas + 1;
  end if;

  select status into v_st from public.contatos where id = v_mao;
  if v_st = 'em_atendimento'
     and (select atendente_id from public.contatos where id = v_mao) = v_uid then
    raise notice '  ✅ 8. contato na mão de alguém não foi puxado de volta';
  else raise warning '  ❌ 8. roubou o contato: %', v_st; v_falhas := v_falhas + 1;
  end if;

  select status into v_st from public.contatos where id = v_perdido;
  if v_st = 'perdido' then
    raise notice '  ✅ 9. perdido com chip morto não volta para a fila';
  else raise warning '  ❌ 9. voltou: %', v_st; v_falhas := v_falhas + 1;
  end if;

  if (select telefone_e164 from public.contatos where id = v_apagado) is null
     and (select status from public.contatos where id = v_apagado) = 'invalido' then
    raise notice '  ✅ 10. telefone apagado pela LGPD não foi ressuscitado';
  else raise warning '  ❌ 10. RESSUSCITOU TELEFONE APAGADO'; v_falhas := v_falhas + 1;
  end if;

  -- ── A origem nunca muda ──────────────────────────────────────────────────
  -- Reimportar não pode transformar quem se cadastrou no site em "um apoiador
  -- me passou seu contato": {{origem}} sai na primeira mensagem, e é uma
  -- afirmação de fato sobre a procedência do dado.
  update public.contatos set origem = 'site' where id = v_fila;
  perform public.importar_contatos(v_velha, 'lista_fria', jsonb_build_array(
    jsonb_build_object('nome','José','primeiro_nome','José','e164','5569230000601',
                       'chave_dedup','6923000601','hmac','hmac-reimp-601','hmac_versao',1)
  ));
  if (select origem from public.contatos where id = v_fila) = 'site' then
    raise notice '  ✅ 11. a origem do contato não é reescrita pela lista nova';
  else raise warning '  ❌ 11. a origem foi reescrita'; v_falhas := v_falhas + 1;
  end if;

  -- ── Reentrante ───────────────────────────────────────────────────────────
  v_r := public.importar_contatos(v_nova, 'lista_fria', jsonb_build_array(
    jsonb_build_object('nome','Ines Nova','primeiro_nome','Ines','e164','5569230000607',
                       'chave_dedup','6923000607','hmac','hmac-reimp-607','hmac_versao',1)
  ));
  if (v_r->>'novos')::int = 0 and (v_r->>'atualizados')::int = 1
     and (select count(*) from public.contatos where telefone_hmac = 'hmac-reimp-607') = 1 then
    raise notice '  ✅ 12. repetir o mesmo bloco não duplica ninguém';
  else raise warning '  ❌ 12. duplicou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── Os totais da lista contam a verdade ──────────────────────────────────
  if (select total_atualizados from public.listas where id = v_nova) >= 5 then
    raise notice '  ✅ 13. a lista registra quantos vieram de outra lista';
  else raise warning '  ❌ 13. total_atualizados: %',
    (select total_atualizados from public.listas where id = v_nova); v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'REIMPORTAÇÃO: ✅ as 13 passaram';
  else raise exception 'REIMPORTAÇÃO: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
