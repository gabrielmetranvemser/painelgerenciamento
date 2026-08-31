-- Apagar uma lista: o que vai junto, e o que se recusa a ir.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ O TESTE 6 É O QUE IMPORTA MAIS. `bloqueios.contato_id` é `on delete set
-- null`, e essa escolha é a única coisa entre "apaguei uma lista" e "o número
-- de quem pediu saída voltou para a base na próxima importação" — que é multa
-- por mensagem. Se alguém trocar aquele FK por `cascade`, este teste cai.
begin;

do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_gestor  uuid := gen_random_uuid();
  v_chip    uuid;
  v_cand    uuid;
  v_vazia   uuid;
  v_limpa   uuid;
  v_falada  uuid;
  v_namao   uuid;
  v_c1      uuid;
  v_c2      uuid;
  v_c3      uuid;
  v_c4      uuid;
  v_r       jsonb;
  v_falhas  int := 0;
begin
  raise notice '── Apagar lista ─────────────────────────────────────────────────────────';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_uid, 'apagar-a@painel.local'), (v_gestor, 'apagar-g@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'ApagarA', true, now()),
         (v_gestor, 'gestor', 'ApagarG', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Apagar', 'ativo', 'ativo') returning id into v_chip;

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-apagar', 'Cand Apagar', 'deputado_federal', 1, '9961', 'RO', true)
  returning id into v_cand;

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Apagar vazia', 'F', current_date) returning id into v_vazia;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Apagar limpa', 'F', current_date) returning id into v_limpa;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Apagar falada', 'F', current_date) returning id into v_falada;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Apagar na mao', 'F', current_date) returning id into v_namao;

  -- Nunca abordado: vai junto com a lista.
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup,
                               telefone_hmac, status)
  values (v_limpa, 'lista_fria', 'Limpo 1', '5569230000501', '6923000501',
          'hmac-apagar-501', 'na_fila')
  returning id into v_c1;
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup,
                               telefone_hmac, status)
  values (v_limpa, 'lista_fria', 'Limpo 2', '5569230000502', '6923000502',
          'hmac-apagar-502', 'na_fila');

  -- Já abordado: a lista vira histórico e não pode ser apagada.
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup,
                               telefone_hmac, status)
  values (v_falada, 'lista_fria', 'Falado', '5569230000503', '6923000503',
          'hmac-apagar-503', 'autorizou')
  returning id into v_c2;
  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa,
                                 dia_operacional, aberto_wa_em, texto_enviado)
  values (v_c2, v_uid, v_chip, 'abertura', public.hoje_operacional(), now(), 'oi');

  -- Na mão de alguém agora, mas nada enviado ainda.
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               claimed_at, claim_expira_em)
  values (v_namao, 'lista_fria', 'Na mao', '5569230000504', '6923000504',
          'hmac-apagar-504', 'em_atendimento', v_uid, v_chip, now(), now() + interval '10 min')
  returning id into v_c3;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);

  -- =========================================================================
  v_r := public.apagar_lista(v_vazia);
  if (v_r->>'ok')::boolean and (v_r->>'contatos_apagados')::int = 0
     and not exists (select 1 from public.listas where id = v_vazia) then
    raise notice '  ✅ 1. lista vazia some sem pedir confirmação';
  else raise warning '  ❌ 1. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Com contatos, a primeira chamada só CONTA — a tela precisa do número.
  v_r := public.apagar_lista(v_limpa);
  if v_r->>'motivo' = 'precisa_confirmar' and (v_r->>'total')::int = 2
     and exists (select 1 from public.listas where id = v_limpa) then
    raise notice '  ✅ 2. lista com contatos pede confirmação e não apaga nada ainda';
  else raise warning '  ❌ 2. %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.apagar_lista(v_limpa, true);
  if (v_r->>'ok')::boolean and (v_r->>'contatos_apagados')::int = 2
     and not exists (select 1 from public.contatos where id = v_c1) then
    raise notice '  ✅ 3. confirmada, a lista e os contatos nunca abordados vão junto';
  else raise warning '  ❌ 3. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ A recusa que protege o histórico.
  v_r := public.apagar_lista(v_falada, true);
  if v_r->>'motivo' = 'tem_historico' and (v_r->>'abordados')::int = 1
     and exists (select 1 from public.listas where id = v_falada)
     and exists (select 1 from public.contatos where id = v_c2) then
    raise notice '  ✅ 4. lista com gente já abordada é recusada, mesmo confirmando';
  else raise warning '  ❌ 4. APAGOU HISTÓRICO: %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.apagar_lista(v_namao, true);
  if v_r->>'motivo' = 'contato_em_atendimento'
     and exists (select 1 from public.contatos where id = v_c3) then
    raise notice '  ✅ 5. contato na mão de alguém agora impede o apagamento';
  else raise warning '  ❌ 5. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · O BLOQUEIO SOBREVIVE
  -- =========================================================================
  -- Contato nunca abordado mas com bloqueio (veio de descadastro público, ou de
  -- um reparo do gestor). Apagar a lista apaga o contato — e o bloqueio TEM de
  -- ficar, senão o mesmo número volta na próxima importação.
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Apagar com bloqueio', 'F', current_date) returning id into v_vazia;
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup,
                               telefone_hmac, status)
  values (v_vazia, 'lista_fria', 'Bloqueado', '5569230000505', '6923000505',
          'hmac-apagar-505', 'na_fila')
  returning id into v_c4;
  insert into public.bloqueios (telefone_hmac, hmac_versao, motivo, origem, contato_id, apagar_em)
  values ('hmac-apagar-505', 1, 'Pediu saída pelo link', 'descadastro', v_c4,
          now() + interval '48 hours');

  v_r := public.apagar_lista(v_vazia, true);
  if (v_r->>'ok')::boolean
     and not exists (select 1 from public.contatos where id = v_c4)
     and exists (select 1 from public.bloqueios where telefone_hmac = 'hmac-apagar-505') then
    raise notice '  ✅ 6. o contato vai, o BLOQUEIO fica — o número não volta numa importação';
  else raise warning '  ❌ 6. O BLOQUEIO SUMIU JUNTO: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 7 · Só o gestor apaga
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_r := public.apagar_lista(v_falada, true);
  if v_r->>'motivo' = 'somente_gestor' then
    raise notice '  ✅ 7. atendente não apaga lista';
  else raise warning '  ❌ 7. %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'APAGAR LISTA: ✅ as 7 passaram';
  else raise exception 'APAGAR LISTA: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
