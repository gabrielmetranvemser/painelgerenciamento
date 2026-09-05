-- Aparelhos liberados: sem a marca, o painel não existe.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ OS TESTES 4 E 7 SÃO O CORAÇÃO.
--
-- O 4 vigia o USO ÚNICO. O convite viaja por WhatsApp, e mensagem encaminhada é
-- o caminho mais curto para um link de liberação circular. Queimando no primeiro
-- uso, um reencaminhamento não libera um segundo aparelho — e o gestor descobre,
-- porque a pessoa certa reclama que não funcionou.
--
-- O 7 vigia a REVOGAÇÃO. Atendente que sai da campanha, notebook perdido: o
-- cookie continua assinado e válido na criptografia, e é só esta consulta que
-- separa "assinatura correta" de "ainda autorizado".
begin;

do $$
declare
  v_gestor uuid := gen_random_uuid();
  v_at     uuid := gen_random_uuid();
  v_id     uuid;
  v_r      jsonb;
  v_falhas int := 0;
begin
  raise notice '── Aparelhos liberados ──────────────────────────────────────────────────';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_gestor, 'apa-g@painel.local'), (v_at, 'apa-a@painel.local')) as x(id, email);
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_gestor, 'gestor', 'ApaG', true, now()),
         (v_at, 'atendente', 'ApaA', true, now());

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 1 · O gestor gera o convite
  -- =========================================================================
  v_r := public.criar_convite_aparelho(v_at, 'Notebook da ApaA', 'hash-conv-1', 48);
  v_id := (v_r->>'id')::uuid;
  if (v_r->>'ok')::boolean
     and (select liberado_em is null and codigo_hash = 'hash-conv-1'
            from public.aparelhos where id = v_id) then
    raise notice '  ✅ 1. convite criado, ainda não usado';
  else raise warning '  ❌ 1. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 2 · Código errado responde igual a código vencido: nada a aprender
  -- =========================================================================
  if (public.usar_convite_aparelho('nao-existe')->>'motivo') = 'convite_invalido' then
    raise notice '  ✅ 2. código desconhecido é recusado sem dizer por quê';
  else raise warning '  ❌ 2. aceitou código inexistente'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 3 · Usar o convite libera o aparelho
  -- =========================================================================
  v_r := public.usar_convite_aparelho('hash-conv-1', 'Mozilla/5.0 Teste');
  if (v_r->>'ok')::boolean
     and (v_r->>'id')::uuid = v_id
     and (select liberado_em is not null from public.aparelhos where id = v_id) then
    raise notice '  ✅ 3. convite usado libera o aparelho';
  else raise warning '  ❌ 3. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · ⚠️ USO ÚNICO: o mesmo link não libera um segundo aparelho
  -- =========================================================================
  if (public.usar_convite_aparelho('hash-conv-1')->>'motivo') = 'convite_invalido'
     and (select codigo_hash is null from public.aparelhos where id = v_id) then
    raise notice '  ✅ 4. o convite queima no primeiro uso';
  else raise warning '  ❌ 4. LINK REUTILIZÁVEL: encaminhar a mensagem libera outro aparelho';
       v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 5 · Convite vencido não vale
  -- =========================================================================
  perform public.criar_convite_aparelho(v_at, 'Vencido', 'hash-conv-2', 1);
  update public.aparelhos set expira_em = now() - interval '1 minute'
   where codigo_hash = 'hash-conv-2';
  if (public.usar_convite_aparelho('hash-conv-2')->>'motivo') = 'convite_invalido' then
    raise notice '  ✅ 5. convite vencido é recusado';
  else raise warning '  ❌ 5. aceitou convite vencido'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · O aparelho liberado vale
  -- =========================================================================
  if public.aparelho_ativo(v_id) then
    raise notice '  ✅ 6. aparelho liberado é reconhecido';
  else raise warning '  ❌ 6. aparelho liberado não vale'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 7 · ⚠️ REVOGAR TIRA DO AR
  -- =========================================================================
  v_r := public.revogar_aparelho(v_id);
  if (v_r->>'ok')::boolean and not public.aparelho_ativo(v_id) then
    raise notice '  ✅ 7. revogado deixa de valer na hora';
  else raise warning '  ❌ 7. COOKIE SOBREVIVEU À REVOGAÇÃO: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- E a linha CONTINUA existindo: é o histórico de quem entrava de onde.
  if (select count(*) from public.aparelhos where id = v_id) = 1 then
    raise notice '  ✅ 8. revogar não apaga o histórico do aparelho';
  else raise warning '  ❌ 8. apagou a linha'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 9 · Atendente não libera nem revoga aparelho
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_at, 'role', 'authenticated')::text, true);

  if (public.criar_convite_aparelho(v_at, 'Meu', 'hash-conv-3', 48)->>'motivo') = 'somente_gestor'
     and (public.revogar_aparelho(v_id)->>'motivo') = 'somente_gestor' then
    raise notice '  ✅ 9. atendente não gera convite nem revoga aparelho';
  else raise warning '  ❌ 9. atendente mexeu em aparelho'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 10 · A trava nasce desligada
  -- =========================================================================
  if not public.exigir_aparelho() then
    raise notice '  ✅ 10. a trava nasce desligada — ligar antes de liberar trancaria o gestor';
  else raise warning '  ❌ 10. trava já veio ligada'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'APARELHOS LIBERADOS: ✅ as 10 passaram';
  else raise exception 'APARELHOS LIBERADOS: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
