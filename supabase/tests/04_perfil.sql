-- Perfil do contato: correção de resultado, pedido de kit e histórico.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

-- ⚠️ A janela de horário abre para o teste inteiro (revertida pelo rollback).
--
-- As travas de verdade recusam envio fora do horário de operação, então esta
-- suíte só passava entre 9h e 20h de Porto Velho: rodá-la às 21h devolvia uma
-- parede de ❌ que não eram falhas. Um teste que só roda no horário comercial é
-- um teste que ninguém roda antes de subir código à noite — que é exatamente
-- quando se sobe código.
update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;

do $$
declare
  v_uid   uuid := gen_random_uuid();
  v_uid2  uuid := gen_random_uuid();
  v_chip  uuid;
  v_c     uuid;
  v_r     jsonb;
  v_falhas int := 0;
  v_token text;
  v_cand  uuid;
begin
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  for i in 1..2 loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      case i when 1 then v_uid else v_uid2 end,
      'authenticated', 'authenticated', 'perfil-' || i || '@painel.local',
      extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    );
    insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
    values (case i when 1 then v_uid else v_uid2 end, 'atendente', 'Perfil' || i, true, now());
  end loop;

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Perfil', 'ativo', 'ativo') returning id into v_chip;

  insert into public.candidatos (slug, nome_urna, cargo, numero, ativo)
  values ('perfil-teste', 'Perfil Cand', 'deputado_federal', '4001', true)
  returning id into v_cand;

  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id, primeiro_contato_em)
  values ('lista_fria', 'Perfil Contato', 'Perfil', '5569200000001', '6920000001',
          'hmac-perfil-0001', 'sem_resposta', v_uid, v_chip, now() - interval '3 days')
  returning id into v_c;

  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa, aberto_wa_em, dia_operacional, texto_enviado)
  values (v_c, v_uid, v_chip, 'permissao', now() - interval '3 days', public.hoje_operacional(), 'oi');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- ── 1. Corrigir resultado dias depois ─────────────────────────────────────
  -- Caso 12 do Doc 3 §6: a pessoa responde dias depois.
  v_r := public.registrar_resultado(v_c, 'autorizou');
  if (v_r->>'ok')::boolean and (select status from public.contatos where id = v_c) = 'autorizou' then
    raise notice '  ✅ 1. dá para corrigir o resultado depois de já ter marcado';
  else raise warning '  ❌ 1. não corrigiu: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. Corrigir um "Pediu saída" clicado por engano ───────────────────────
  -- ⚠️ O comportamento MUDOU na migration 20260823340300, e a mudança é a
  -- correção de um achado da auditoria: até então o próprio atendente apagava o
  -- bloqueio, e o gestor só era avisado depois do fato.
  --
  -- O caso real continua tendo saída — a tecla "2" marca "Pediu saída" e é fácil
  -- apertar sem querer —, mas ela passa pelo gestor: o atendente é recusado, um
  -- alerta com o contato em anexo vai para a tela de Suporte, e é lá que o
  -- bloqueio é desfeito. Mandar mensagem para quem pediu saída é multa POR
  -- MENSAGEM; a decisão não pode ficar com quem tem pressa.
  perform public.registrar_resultado(v_c, 'pediu_saida');
  if not exists (select 1 from public.bloqueios b
                  join public.contatos c on c.telefone_hmac = b.telefone_hmac where c.id = v_c) then
    raise warning '  ❌ 2a. "Pediu saída" não bloqueou'; v_falhas := v_falhas + 1;
  end if;

  v_r := public.registrar_resultado(v_c, 'autorizou');
  if v_r->>'motivo' = 'saida_so_o_gestor_desfaz'
     and exists (select 1 from public.bloqueios b
                  join public.contatos c on c.telefone_hmac = b.telefone_hmac where c.id = v_c)
     and exists (select 1 from public.alertas
                  where tipo = 'saida_para_revisar' and contato_id = v_c) then
    raise notice '  ✅ 2. o atendente não desfaz o bloqueio; o gestor recebe o pedido';
  else raise warning '  ❌ 2. o atendente desfez o bloqueio sozinho: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. Descadastro feito PELA PESSOA não se desfaz ────────────────────────
  -- Um é engano do atendente; o outro é a vontade de quem recebeu a mensagem.
  --
  -- O bloqueio do teste 2 continua de pé (é justamente o que ele passou a
  -- provar), então aqui só se troca a ORIGEM — inserir de novo bateria na chave
  -- primária de `bloqueios`.
  update public.contatos set status = 'pediu_saida' where id = v_c;
  update public.bloqueios b
     set origem = 'landing', motivo = 'clicou em não quero receber'
    from public.contatos c
   where c.id = v_c and b.telefone_hmac = c.telefone_hmac;

  v_r := public.registrar_resultado(v_c, 'autorizou');
  if v_r->>'motivo' = 'saida_pedida_pela_pessoa'
     and exists (select 1 from public.bloqueios b
                  join public.contatos c on c.telefone_hmac = b.telefone_hmac where c.id = v_c) then
    raise notice '  ✅ 3. descadastro feito pela própria pessoa NÃO é reversível pelo atendente';
  else raise warning '  ❌ 3. atendente desfez o descadastro da pessoa: %', v_r; v_falhas := v_falhas + 1;
  end if;
  delete from public.bloqueios b using public.contatos c
   where c.id = v_c and b.telefone_hmac = c.telefone_hmac;
  delete from public.alertas where contato_id = v_c;
  update public.contatos set status = 'autorizou' where id = v_c;

  -- ── 4. Pedido de kit ──────────────────────────────────────────────────────
  v_r := public.registrar_pedido_kit(
           p_contato_id   => v_c,
           p_itens        => array['santinho','adesivo'],
           p_endereco     => 'Rua das Flores, 100 - Centro',
           p_rua          => 'Rua das Flores',
           p_numero       => '100',
           p_bairro       => 'Centro',
           p_municipio_id => (select id from public.municipios where nome = 'Porto Velho'));
  if (v_r->>'ok')::boolean
     and exists (select 1 from public.captacoes
                  where contato_id = v_c and origem = 'kit'
                    and endereco = 'Rua das Flores, 100 - Centro'
                    and itens @> array['santinho','adesivo'])
     and (select municipio_id from public.contatos where id = v_c) is not null then
    raise notice '  ✅ 4. pedido de kit entra no mesmo relatório da equipe de entrega';
  else raise warning '  ❌ 4. pedido de kit falhou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 5. Editar o pedido não duplica ────────────────────────────────────────
  perform public.registrar_pedido_kit(
            p_contato_id => v_c, p_itens => array['camiseta'],
            p_endereco => 'Rua Nova, 200', p_rua => 'Rua Nova', p_numero => '200');
  if (select count(*) from public.captacoes where contato_id = v_c and origem = 'kit') = 1
     and (select endereco from public.captacoes where contato_id = v_c) = 'Rua Nova, 200' then
    raise notice '  ✅ 5. corrigir o endereço atualiza, não cria um segundo pedido';
  else raise warning '  ❌ 5. duplicou o pedido'; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Contato de outro atendente é intocável ─────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid2, 'role', 'authenticated')::text, true);
  v_r := public.registrar_pedido_kit(
           p_contato_id => v_c, p_itens => array['santinho'], p_endereco => 'x');
  if v_r->>'motivo' = 'contato_nao_e_seu' then
    raise notice '  ✅ 6. não dá para mexer no contato de outro atendente';
  else raise warning '  ❌ 6. mexeu em contato alheio: %', v_r; v_falhas := v_falhas + 1;
  end if;
  v_r := public.historico_contato(v_c);
  if v_r->>'motivo' = 'contato_nao_e_seu' then
    raise notice '  ✅ 6b. nem de ver o histórico dele';
  else raise warning '  ❌ 6b. viu histórico alheio'; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. Histórico: clique de gente conta, pré-carregamento não ─────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  -- O link agora aponta para a PÁGINA do candidato — não existe mais destino
  -- global. É esse token que a mensagem manda.
  v_token := public.garantir_link_candidato(v_c, v_cand);
  insert into public.cliques (token, is_bot, user_agent) values
    (v_token, true,  'WhatsApp/2.24'),
    (v_token, false, 'Mozilla/5.0 (Linux; Android 13)');

  v_r := public.historico_contato(v_c);
  if (v_r->>'ok')::boolean
     and jsonb_array_length(v_r->'interacoes') = 1
     and jsonb_array_length(v_r->'cliques') = 1
     and v_r->'pedido_kit'->>'endereco' = 'Rua Nova, 200' then
    raise notice '  ✅ 7. histórico traz a conversa, o clique REAL e o pedido de kit';
  else raise warning '  ❌ 7. histórico incorreto: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 8. A confirmação de Saída é a ÚNICA mensagem que alcança um bloqueado ──
  -- registrar_resultado('pediu_saida') bloqueia no mesmo commit. Sem a exceção,
  -- a mensagem que avisa "já tirei seu número da lista" ficaria impossível de
  -- mandar. Todas as outras continuam barradas: envio a quem pediu saída gera
  -- multa POR MENSAGEM.
  update public.contatos set status = 'em_atendimento', claim_expira_em = now() + interval '20 min'
   where id = v_c;
  perform public.registrar_resultado(v_c, 'pediu_saida');

  v_r := public.registrar_abertura(v_c, v_chip, 'saida', 'Tranquilo, já tirei seu número.');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 8. a confirmação de Saída alcança quem acabou de ser bloqueado';
  else raise warning '  ❌ 8. não deu para confirmar a saída: %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.registrar_abertura(v_c, v_chip, 'convite_grupo', 'entra no canal');
  if v_r->>'motivo' = 'contato_bloqueado' then
    raise notice '  ✅ 8b. e nenhuma outra mensagem passa pelo bloqueio';
  else raise warning '  ❌ 8b. mandou outra mensagem para bloqueado: %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas > 0 then raise exception 'PERFIL: ❌ % falha(s)', v_falhas; end if;
  raise notice 'PERFIL DO CONTATO: ✅ as 10 passaram';
end $$;

rollback;
