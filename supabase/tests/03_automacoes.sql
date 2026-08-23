-- Automações do cron.
--
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK. Roda a qualquer
-- momento, inclusive com a base em produção.
--
--   psql -f supabase/tests/03_automacoes.sql
begin;

do $$
declare
  v_uid uuid := gen_random_uuid();
  v_chip uuid;
  v_contato uuid;
  v_n int;
  v_falhas int := 0;
begin
  -- ── Fixtures ──────────────────────────────────────────────────────────────
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    'automacao@painel.local', extensions.crypt('x', extensions.gen_salt('bf')),
    now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
  );
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'Automacao', true, now());
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Automacao', 'ativo', 'ativo') returning id into v_chip;

  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup, telefone_hmac, status)
  values ('lista_fria', 'Automacao Contato', 'Automacao', '5569100000001', '6910000001',
          'hmac-automacao-0001', 'na_fila')
  returning id into v_contato;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- ── 1. Lease vencido SEM conversa aberta volta para a fila ────────────────
  -- Contato preso é fila parada, e quem pegou pode ter ido embora — por isso
  -- volta para o bolo geral, sem dono.
  update public.contatos
     set status = 'em_atendimento', atendente_id = v_uid, chip_id = v_chip,
         claimed_at = now() - interval '30 minutes',
         claim_expira_em = now() - interval '10 minutes'
   where id = v_contato;

  v_n := public.expirar_leases();
  if v_n >= 1
     and (select status from public.contatos where id = v_contato) = 'na_fila'
     and (select atendente_id from public.contatos where id = v_contato) is null then
    raise notice '  ✅ 1. lease vencido devolveu o contato para o bolo geral';
  else raise warning '  ❌ 1. lease não expirou'; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. Lease vencido COM conversa aberta NÃO volta ────────────────────────
  -- Devolver seria reabordar quem já foi abordado. Uma tentativa por pessoa.
  update public.contatos
     set status = 'em_atendimento', atendente_id = v_uid, chip_id = v_chip,
         primeiro_contato_em = now() - interval '2 hours',
         claim_expira_em = now() - interval '1 hour'
   where id = v_contato;
  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa, aberto_wa_em, dia_operacional)
  values (v_contato, v_uid, v_chip, 'permissao', now() - interval '2 hours', public.hoje_operacional());

  perform public.expirar_leases();
  if (select status from public.contatos where id = v_contato) = 'em_atendimento' then
    raise notice '  ✅ 2. quem já foi abordado não volta para a fila';
  else raise warning '  ❌ 2. contato já abordado voltou para a fila'; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. 72h sem resposta fecha ─────────────────────────────────────────────
  update public.contatos set primeiro_contato_em = now() - interval '80 hours' where id = v_contato;
  v_n := public.fechar_sem_resposta();
  if (select status from public.contatos where id = v_contato) = 'sem_resposta' then
    raise notice '  ✅ 3. 72h sem resposta fecha o contato';
  else raise warning '  ❌ 3. 72h não fechou'; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. Purga LGPD apaga o dado e MANTÉM o bloqueio ────────────────────────
  -- As duas promessas ao mesmo tempo: apagar o número em 48h e nunca mais
  -- falar com a pessoa, nem se ela voltar numa importação futura.
  update public.contatos set status = 'pediu_saida' where id = v_contato;
  insert into public.bloqueios (telefone_hmac, motivo, apagar_em)
  select telefone_hmac, 'teste', now() - interval '1 hour'
    from public.contatos where id = v_contato;

  perform public.purgar_dados_de_saida();
  if (select telefone_e164 is null and nome is null and chave_dedup is null
             and anonimizado_em is not null
        from public.contatos where id = v_contato)
     and exists (select 1 from public.bloqueios b
                  join public.contatos c on c.telefone_hmac = b.telefone_hmac
                 where c.id = v_contato) then
    raise notice '  ✅ 4. purga apagou nome e telefone, e o bloqueio sobreviveu';
  else raise warning '  ❌ 4. purga incorreta'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas > 0 then raise exception 'AUTOMAÇÕES: ❌ % falha(s)', v_falhas; end if;
  raise notice 'AUTOMAÇÕES: ✅ as 4 passaram';
end $$;

rollback;
