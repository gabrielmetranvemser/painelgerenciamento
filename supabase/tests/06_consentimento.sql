-- O escopo do consentimento e o roteamento da fila por candidato.
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
  v_a uuid := gen_random_uuid();   -- atende Fed + Gov
  v_b uuid := gen_random_uuid();   -- atende só o Sen
  v_chip_a uuid; v_chip_b uuid;
  v_fed uuid; v_gov uuid; v_sen uuid;
  v_c uuid; v_c_sen uuid; v_c_livre uuid;
  v_r jsonb;
  v_falhas int := 0;
  i int;
begin
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  for i in 1..2 loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      case i when 1 then v_a else v_b end, 'authenticated', 'authenticated',
      'cons-' || i || '@painel.local', extensions.crypt('x', extensions.gen_salt('bf')),
      now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    );
    insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
    values (case i when 1 then v_a else v_b end, 'atendente', 'Cons' || i, true, now());
  end loop;

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_a, 'Chip Cons A', 'ativo', 'ativo') returning id into v_chip_a;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_b, 'Chip Cons B', 'ativo', 'ativo') returning id into v_chip_b;

  insert into public.candidatos (slug, nome_urna, cargo, numero) values
    ('cons-fed', 'Fed Cons', 'deputado_federal', '4444') returning id into v_fed;
  insert into public.candidatos (slug, nome_urna, cargo, numero) values
    ('cons-gov', 'Gov Cons', 'governador', '44') returning id into v_gov;
  insert into public.candidatos (slug, nome_urna, cargo, numero) values
    ('cons-sen', 'Sen Cons', 'senador', '444') returning id into v_sen;

  insert into public.materiais (candidato_id, titulo, url, tipo) values
    (v_fed, 'Santinho do Fed', 'https://exemplo.invalid/fed.pdf', 'santinho'),
    (v_gov, 'Propostas do Gov', 'https://exemplo.invalid/gov', 'propostas');

  -- A atende Fed (principal) e Gov. B atende só o Sen.
  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal) values
    (v_a, v_fed, 'deputado_federal', 1, true),
    (v_a, v_gov, 'governador',       1, false),
    (v_b, v_sen, 'senador',          1, false);

  -- Uma lista ativa para os dois. Este arquivo é sobre ROTEAMENTO por
  -- candidato, e desde que cada lista tem dono um atendente sem lista recebe
  -- `sem_lista` no lugar de `fila_vazia` — o que faria o teste 10 medir a
  -- configuração da pessoa em vez do roteamento que ele existe para provar.
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Cons Lista', 'Fornecedor de Teste', current_date);
  insert into public.atendente_listas (atendente_id, lista_id)
  select x.id, (select id from public.listas where rotulo = 'Cons Lista')
    from (values (v_a), (v_b)) as x(id);

  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id, claim_expira_em)
  values ('lista_fria', 'Cons Contato', 'Cons', '5569300000001', '6930000001',
          'hmac-cons-0001', 'em_atendimento', v_a, v_chip_a, now() + interval '20 min')
  returning id into v_c;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- ── 1. A Permissão devolve a chapa inteira ────────────────────────────────
  v_r := public.preparar_mensagem(v_c, v_chip_a, 'permissao');
  if (v_r->>'ok')::boolean and jsonb_array_length(v_r->'chapa') = 2
     and v_r->'chapa'->0->>'nome' = 'Fed Cons' then
    raise notice '  ✅ 1. a Permissão traz a chapa inteira, principal primeiro';
  else raise warning '  ❌ 1. chapa incorreta: %', v_r->'chapa'; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. Material antes da permissão é recusado ─────────────────────────────
  -- Nada foi declarado ainda, então não há consentimento a invocar.
  v_r := public.preparar_mensagem(v_c, v_chip_a, 'material', v_fed);
  if v_r->>'motivo' = 'candidato_nao_declarado' then
    raise notice '  ✅ 2. material recusado antes de a permissão ser enviada';
  else raise warning '  ❌ 2. deixou mandar material sem declarar: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. Enviar a permissão congela o que foi declarado ────────────────────
  v_r := public.registrar_abertura(v_c, v_chip_a, 'permissao', 'texto da permissão');
  if (v_r->>'ok')::boolean and (v_r->>'candidatos_declarados')::int = 2
     and (select count(*) from public.contato_candidato where contato_id = v_c) = 2 then
    raise notice '  ✅ 3. enviar a permissão congelou os 2 candidatos declarados';
  else raise warning '  ❌ 3. não congelou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. Material do candidato declarado sai, com link próprio ─────────────
  v_r := public.preparar_mensagem(v_c, v_chip_a, 'material', v_fed);
  if (v_r->>'ok')::boolean
     and v_r->'candidato'->>'nome' = 'Fed Cons'
     and jsonb_array_length(v_r->'materiais') = 1
     and length(v_r->'materiais'->0->>'token') = 12 then
    raise notice '  ✅ 4. material do candidato declarado sai com link rastreado próprio';
  else raise warning '  ❌ 4. material incorreto: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 5. Candidato acrescentado DEPOIS não alcança quem já autorizou ───────
  -- É a trava central: sem ela, bastaria acrescentar um candidato à chapa para
  -- fazer propaganda a uma base inteira que nunca consentiu com aquele nome.
  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga)
  values (v_a, v_sen, 'senador', 1);

  v_r := public.preparar_mensagem(v_c, v_chip_a, 'material', v_sen);
  if v_r->>'motivo' = 'candidato_nao_declarado' then
    raise notice '  ✅ 5. candidato acrescentado depois NÃO alcança quem já autorizou';
  else raise warning '  ❌ 5. alcançou sem consentimento: %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.registrar_abertura(v_c, v_chip_a, 'material', 'texto', null, v_sen);
  if v_r->>'motivo' = 'candidato_nao_declarado' then
    raise notice '  ✅ 5b. e o envio também é barrado, não só a montagem do texto';
  else raise warning '  ❌ 5b. o envio passou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Material enviado marca a trilha ───────────────────────────────────
  -- Envelhece a permissão: desde a migration 330300 o intervalo mínimo também
  -- vale para o material, e mandar a peça no mesmo segundo do "pode" é a rajada
  -- que a trava existe para impedir. Aqui o que se mede é a trilha, não o
  -- ritmo — por isso o relógio anda.
  update public.interacoes set aberto_wa_em = now() - interval '600 seconds'
   where contato_id = v_c and aberto_wa_em is not null;

  v_r := public.registrar_abertura(v_c, v_chip_a, 'material', 'material fed', null, v_fed);
  if (v_r->>'ok')::boolean
     and (select material_enviado_em is not null from public.contato_candidato
           where contato_id = v_c and candidato_id = v_fed) then
    raise notice '  ✅ 6. envio do material fica registrado com data, por candidato';
  else raise warning '  ❌ 6. não registrou o envio: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. Cada candidato tem a sua própria interação ────────────────────────
  v_r := public.preparar_mensagem(v_c, v_chip_a, 'material', v_gov);
  perform public.registrar_abertura(v_c, v_chip_a, 'material', 'material gov', null, v_gov);
  if (select count(*) from public.interacoes
       where contato_id = v_c and etapa = 'material') = 2 then
    raise notice '  ✅ 7. dois candidatos, duas interações de material';
  else raise warning '  ❌ 7. as interações de material colidiram'; v_falhas := v_falhas + 1;
  end if;

  -- ── 8. A permissão continua acontecendo UMA vez só ───────────────────────
  -- É o que `nulls not distinct` garante: sem ele, cada NULL seria valor
  -- diferente e o mesmo contato receberia duas permissões.
  perform public.registrar_abertura(v_c, v_chip_a, 'permissao', 'de novo');
  if (select count(*) from public.interacoes
       where contato_id = v_c and etapa = 'permissao') = 1 then
    raise notice '  ✅ 8. a permissão segue idempotente, uma por contato';
  else raise warning '  ❌ 8. gravou permissão duplicada'; v_falhas := v_falhas + 1;
  end if;

  -- ── 9. Lead de candidato só vai para quem atende aquele candidato ────────
  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, candidato_origem_id, criado_em)
  values ('site', 'Lead do Sen', 'Lead', '5569300000002', '6930000002',
          'hmac-cons-0002', 'na_fila', v_sen, now() - interval '1 year')
  returning id into v_c_sen;

  -- Esvazia o resto da fila para o teste medir só o roteamento.
  update public.contatos set status = 'sem_resposta'
   where status = 'na_fila' and id <> v_c_sen;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_r := public.pegar_proximo_contato(v_chip_b);
  if (v_r->>'ok')::boolean and (v_r->'contato'->>'id')::uuid = v_c_sen then
    raise notice '  ✅ 9. quem atende o candidato recebe o lead dele';
  else raise warning '  ❌ 9. não entregou ao atendente certo: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Devolve para a fila e tenta com quem NÃO atende aquele candidato.
  update public.contatos set status='na_fila', atendente_id=null, chip_id=null,
         claimed_at=null, claim_expira_em=null where id = v_c_sen;
  update public.atendente_candidatos set candidato_id = candidato_id
   where atendente_id = v_a;  -- A não atende o Sen? Atende (inserido no teste 5).
  delete from public.atendente_candidatos where atendente_id = v_a and candidato_id = v_sen;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  update public.contatos set status='sem_resposta' where id = v_c;  -- libera o atendente A
  -- Envelhece as aberturas: senão a trava de intervalo dispara antes e o teste
  -- mediria o intervalo em vez do roteamento.
  update public.interacoes set aberto_wa_em = now() - interval '600 seconds'
   where atendente_id = v_a;

  v_r := public.pegar_proximo_contato(v_chip_a);
  if v_r->>'motivo' = 'fila_vazia' and (v_r->'fila'->>'quentes_na_fila')::int = 0 then
    raise notice '  ✅ 10. quem NÃO atende o candidato não recebe o lead — nem no contador';
  else raise warning '  ❌ 10. entregou lead de candidato alheio: %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas > 0 then raise exception 'CONSENTIMENTO: ❌ % falha(s)', v_falhas; end if;
  raise notice 'CONSENTIMENTO E ROTEAMENTO: ✅ os 10 passaram';
end $$;

rollback;
