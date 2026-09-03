-- "Autorizou" congela o consentimento e libera o material, sem a Permissão.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ OS TESTES 3 E 6 SÃO OS QUE IMPORTAM, e por motivos opostos.
--
-- O 3 vigia a MARCA: quando a chapa é declarada por um ato do atendente, e não
-- pela mensagem de permissão, a linha precisa dizer isso para sempre
-- (`declarado_em_reparo`). É a diferença entre "a pessoa leu os nomes e disse
-- pode" e "o atendente afirma que ela disse pode" — e quem vai precisar dessa
-- distinção é o advogado, não a tela.
--
-- O 6 vigia o contrário: quando a permissão SAIU, a marca tem de continuar
-- limpa. Se marcar Autorizou sujasse a linha que já estava certa, o painel
-- perderia a prova mais forte que tem justo no caminho mais comum.
begin;

update public.config set hora_inicio = 0, hora_fim = 24, intervalo_seg = 0 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_uid    uuid := gen_random_uuid();
  v_sem    uuid := gen_random_uuid();  -- atendente SEM chapa
  v_chip   uuid;
  v_chip2  uuid;
  v_c1     uuid;  -- só abertura, marca Autorizou
  v_c2     uuid;  -- permissão enviada de verdade
  v_c3     uuid;  -- do atendente sem chapa
  v_ca     uuid;
  v_cb     uuid;
  v_lista  uuid;
  v_r      jsonb;
  v_falhas int := 0;
begin
  raise notice '── Autorizou libera o material ──────────────────────────────────────────';

  update public.contatos set adiado_ate = now() + interval '1 day' where status = 'na_fila';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_uid, 'aut-a@painel.local'), (v_sem, 'aut-b@painel.local')) as x(id, email);
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'AutA', true, now()),
         (v_sem, 'atendente', 'AutB', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Aut', 'ativo', 'ativo') returning id into v_chip;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_sem, 'Chip Sem', 'ativo', 'ativo') returning id into v_chip2;

  -- Chapa de DOIS candidatos: a declaração é da chapa inteira, não do principal.
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-aut-1', 'Cand Aut 1', 'deputado_federal', 1, '9941', 'RO', true)
  returning id into v_ca;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-aut-2', 'Cand Aut 2', 'deputado_estadual', 1, '99421', 'RO', true)
  returning id into v_cb;
  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_uid, v_ca, 'deputado_federal', 1, true),
         (v_uid, v_cb, 'deputado_estadual', 1, false);

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Teste Aut', 'F', current_date) returning id into v_lista;
  insert into public.atendente_listas (atendente_id, lista_id) values (v_uid, v_lista);

  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
    chave_dedup, telefone_hmac, status, atendente_id, chip_id, claimed_at, claim_expira_em)
  values (v_lista, 'lista_fria', 'Aut Um', 'Aut', '5569230000801', '6923000801',
          'hmac-aut-801', 'em_atendimento', v_uid, v_chip, now(), now() + interval '30 min')
  returning id into v_c1;
  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
    chave_dedup, telefone_hmac, status, atendente_id, chip_id, claimed_at, claim_expira_em)
  values (v_lista, 'lista_fria', 'Aut Dois', 'Aut', '5569230000802', '6923000802',
          'hmac-aut-802', 'em_atendimento', v_uid, v_chip, now(), now() + interval '30 min')
  returning id into v_c2;
  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
    chave_dedup, telefone_hmac, status, atendente_id, chip_id, claimed_at, claim_expira_em)
  values (v_lista, 'lista_fria', 'Aut Tres', 'Aut', '5569230000803', '6923000803',
          'hmac-aut-803', 'em_atendimento', v_sem, v_chip2, now(), now() + interval '30 min')
  returning id into v_c3;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 1 · Só a abertura saiu. Antes, isto deixava a ficha sem material nenhum.
  -- =========================================================================
  perform public.preparar_mensagem(v_c1, v_chip, 'abertura');
  perform public.registrar_abertura(v_c1, v_chip, 'abertura', 'oi');

  if (select count(*) from public.contato_candidato where contato_id = v_c1) = 0 then
    raise notice '  ✅ 1. depois do "oi", ninguém foi declarado ainda';
  else raise warning '  ❌ 1. declarou cedo demais'; v_falhas := v_falhas + 1;
  end if;

  v_r := public.registrar_resultado(v_c1, 'autorizou');
  if (v_r->>'ok')::boolean and (v_r->>'candidatos_declarados')::int = 2 then
    raise notice '  ✅ 2. marcar Autorizou declara a CHAPA INTEIRA (os dois candidatos)';
  else raise warning '  ❌ 2. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ A MARCA.
  if (select bool_and(declarado_em_reparo) from public.contato_candidato
       where contato_id = v_c1) then
    raise notice '  ✅ 3. e a linha registra que NÃO veio da mensagem de permissão';
  else raise warning '  ❌ 3. CONSENTIMENTO SEM RASTRO: parece declarado por escrito';
       v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · E o material passa a poder sair
  -- =========================================================================
  update public.contatos set status = 'em_atendimento',
         claim_expira_em = now() + interval '30 min' where id = v_c1;
  v_r := public.preparar_mensagem(v_c1, v_chip, 'material', v_ca);
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 4. o material do candidato pode ser preparado';
  else raise warning '  ❌ 4. %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.registrar_abertura(v_c1, v_chip, 'material', 'material', null, v_ca);
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 5. e enviado — a trava de candidato_nao_declarado não morde mais';
  else raise warning '  ❌ 5. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · Quem mandou a Permissão de verdade mantém a marca LIMPA
  -- =========================================================================
  perform public.preparar_mensagem(v_c2, v_chip, 'permissao');
  perform public.registrar_abertura(v_c2, v_chip, 'permissao', 'posso mandar?');
  perform public.registrar_resultado(v_c2, 'autorizou');

  if (select count(*) from public.contato_candidato where contato_id = v_c2) = 2
     and not (select bool_or(declarado_em_reparo) from public.contato_candidato
               where contato_id = v_c2) then
    raise notice '  ✅ 6. permissão enviada: a chapa fica declarada POR ESCRITO, sem a marca';
  else raise warning '  ❌ 6. SUJOU A PROVA de quem fez o caminho certo';
       v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 7 · Os outros desfechos não declaram ninguém
  -- =========================================================================
  update public.contatos set status = 'em_atendimento',
         claim_expira_em = now() + interval '30 min' where id = v_c1;
  delete from public.contato_candidato where contato_id = v_c1;
  v_r := public.registrar_resultado(v_c1, 'invalido');
  if (select count(*) from public.contato_candidato where contato_id = v_c1) = 0 then
    raise notice '  ✅ 7. "Número inválido" não declara candidato nenhum';
  else raise warning '  ❌ 7. declarou fora do "Autorizou"'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 8 · Atendente sem chapa: nada é declarado, e a tela precisa saber
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_sem, 'role', 'authenticated')::text, true);
  perform public.preparar_mensagem(v_c3, v_chip2, 'abertura');
  perform public.registrar_abertura(v_c3, v_chip2, 'abertura', 'oi');
  v_r := public.registrar_resultado(v_c3, 'autorizou');
  if (v_r->>'ok')::boolean and (v_r->>'candidatos_declarados')::int = 0
     and (select count(*) from public.contato_candidato where contato_id = v_c3) = 0 then
    raise notice '  ✅ 8. atendente sem chapa não declara ninguém, e o desfecho é gravado';
  else raise warning '  ❌ 8. %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'AUTORIZOU LIBERA MATERIAL: ✅ as 8 passaram';
  else raise exception 'AUTORIZOU LIBERA MATERIAL: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
