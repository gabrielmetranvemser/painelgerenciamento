-- O RLS de verdade, com o PAPEL de verdade.
--
-- ⚠️ `set local role` em cada bloco não é cerimônia. O psql do teste conecta
-- como superusuário, e superusuário IGNORA RLS: um teste escrito sem trocar de
-- papel passa verde sem ter exercitado uma única policy. É o oposto de um
-- teste — é uma afirmação de segurança com carimbo falso.
--
-- Aqui mora a regra do CLAUDE.md §3: o atendente lê as próprias linhas de
-- `contatos` e não escreve nenhuma. Sem isso, um atendente se auto-atribui a
-- base inteira pelo DevTools.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

do $$
declare
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_meu    uuid;
  v_dele   uuid;
  v_n      int;
  v_erro   text;
  v_falhas int := 0;
begin
  raise notice '── RLS com o papel authenticated ────────────────────────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_a, 'rls-a@painel.local'), (v_b, 'rls-b@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_a, 'atendente', 'RlsA', true, now()),
         (v_b, 'atendente', 'RlsB', true, now());

  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, atendente_id)
  values ('lista_fria', 'Meu RLS', '5569200000901', '6920000901', 'hmac-rls-0901', 'em_atendimento', v_a)
  returning id into v_meu;
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, atendente_id)
  values ('lista_fria', 'Dele RLS', '5569200000902', '6920000902', 'hmac-rls-0902', 'em_atendimento', v_b)
  returning id into v_dele;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- ── 1. Enxerga o próprio contato, e só ele ───────────────────────────────
  execute 'set local role authenticated';
  select count(*) into v_n from public.contatos where id in (v_meu, v_dele);
  execute 'reset role';
  if v_n = 1 then
    raise notice '  ✅ 1. atendente lê o contato dele e não o do colega';
  else raise warning '  ❌ 1. leu % contatos, esperado 1', v_n; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. Não altera nem o PRÓPRIO contato ──────────────────────────────────
  -- Toda mutação passa por RPC. Deixar o atendente escrever direto abriria
  -- auto-atribuição — e a policy de leitura sozinha não impede isso.
  execute 'set local role authenticated';
  update public.contatos set status = 'autorizou' where id = v_meu;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n = 0 and (select status from public.contatos where id = v_meu) = 'em_atendimento' then
    raise notice '  ✅ 2. UPDATE do atendente em contatos não altera nada';
  else raise warning '  ❌ 2. o atendente alterou % linha(s)', v_n; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. Não se auto-atribui o contato do colega ───────────────────────────
  -- É o ataque concreto: um UPDATE e a base inteira fica com um atendente só.
  execute 'set local role authenticated';
  update public.contatos set atendente_id = v_a where id = v_dele;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n = 0 and (select atendente_id from public.contatos where id = v_dele) = v_b then
    raise notice '  ✅ 3. não dá para se auto-atribuir o contato de outro';
  else raise warning '  ❌ 3. roubou o contato do colega'; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. Não insere contato ────────────────────────────────────────────────
  execute 'set local role authenticated';
  begin
    insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status)
    values ('lista_fria', 'Intruso', '5569200000903', '6920000903', 'hmac-rls-0903', 'na_fila');
    v_erro := 'passou';
  exception when others then v_erro := sqlstate;
  end;
  execute 'reset role';
  if v_erro <> 'passou' then
    raise notice '  ✅ 4. INSERT do atendente em contatos é recusado (%)' , v_erro;
  else raise warning '  ❌ 4. o atendente inseriu contato'; v_falhas := v_falhas + 1;
  end if;

  -- ── 5. Não apaga contato ─────────────────────────────────────────────────
  execute 'set local role authenticated';
  delete from public.contatos where id = v_meu;
  get diagnostics v_n = row_count;
  execute 'reset role';
  if v_n = 0 and exists (select 1 from public.contatos where id = v_meu) then
    raise notice '  ✅ 5. DELETE do atendente em contatos não apaga nada';
  else raise warning '  ❌ 5. o atendente apagou contato'; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Não lê a conta do colega ──────────────────────────────────────────
  execute 'set local role authenticated';
  select count(*) into v_n from public.usuarios where id = v_b;
  execute 'reset role';
  if v_n = 0 then
    raise notice '  ✅ 6. atendente não lê a conta de outro usuário';
  else raise warning '  ❌ 6. leu a conta do colega'; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. Não lê a tabela de captação ───────────────────────────────────────
  -- Ela tem endereço de eleitor. Quem precisa é a tela de entregas, do gestor.
  insert into public.captacoes (origem, nome, telefone_e164, chave_dedup, itens, endereco)
  values ('kit', 'Kit RLS', '5569200000904', '6920000904', array['santinho'], 'Rua RLS, 9');

  execute 'set local role authenticated';
  select count(*) into v_n from public.captacoes;
  execute 'reset role';
  if v_n = 0 then
    raise notice '  ✅ 7. atendente não lê endereço de eleitor em captacoes';
  else raise warning '  ❌ 7. atendente leu % captações', v_n; v_falhas := v_falhas + 1;
  end if;

  -- ── 8. Anônimo não lê nada de contatos ───────────────────────────────────
  -- A página pública de candidato é servida com service_role pela rota; o
  -- anônimo em si não pode enxergar a base.
  execute 'set local role anon';
  select count(*) into v_n from public.contatos;
  execute 'reset role';
  if v_n = 0 then
    raise notice '  ✅ 8. anônimo não lê contatos';
  else raise warning '  ❌ 8. anônimo leu % contatos', v_n; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'RLS: ✅ as 8 passaram';
  else raise exception 'RLS: ❌ % falharam', v_falhas;
  end if;
end $$;

rollback;
