-- Quem recebe os cadastros que chegam pelo formulário.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ OS TESTES 3 E 4 SÃO O CORAÇÃO, e vigiam erros opostos.
--
-- O 3 vigia o que o gestor pediu: marcado alguém, o cadastro para de aparecer
-- para o resto da chapa. Se vazar, a escolha dele não vale nada e a pessoa que
-- PEDIU material cai para quem estava no meio de uma lista fria.
--
-- O 4 vigia o modo de falha caro: desmarcado todo mundo, o cadastro volta para
-- a chapa inteira. Se ficasse preso, esquecer de marcar alguém deixaria gente
-- que pediu material esperando sem ninguém saber — e é a pessoa mais quente
-- que este sistema tem.
begin;

update public.config set hora_inicio = 0, hora_fim = 24, intervalo_seg = 0 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_a      uuid := gen_random_uuid();  -- atende o candidato
  v_b      uuid := gen_random_uuid();  -- atende o candidato
  v_fora   uuid := gen_random_uuid();  -- NÃO atende o candidato
  v_cand   uuid;
  v_lista  uuid;
  v_site   uuid;  -- cadastro pelo formulário
  v_fria   uuid;  -- lista fria, para provar que não é afetada
  v_falhas int := 0;

  -- Quantos contatos ESTE atendente enxerga na fila.
begin
  raise notice '── Quem recebe o cadastro do site ───────────────────────────────────────';

  update public.contatos set adiado_ate = now() + interval '1 day' where status = 'na_fila';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_a, 'cap-a@painel.local'), (v_b, 'cap-b@painel.local'),
                 (v_fora, 'cap-f@painel.local')) as x(id, email);
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_a, 'atendente', 'CapA', true, now()),
         (v_b, 'atendente', 'CapB', true, now()),
         (v_fora, 'atendente', 'CapF', true, now());

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-cap-1', 'Cand Cap', 'deputado_federal', 1, '9961', 'RO', true)
  returning id into v_cand;
  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_a, v_cand, 'deputado_federal', 1, true),
         (v_b, v_cand, 'deputado_federal', 1, true);

  -- Uma lista que os três atendem, para o contato frio ser visível a todos.
  insert into public.listas (origem, rotulo, entregue_por, entregue_em, ativa)
  values ('lista_fria', 'Teste Cap', 'F', current_date, true) returning id into v_lista;
  insert into public.atendente_listas (atendente_id, lista_id)
  values (v_a, v_lista), (v_b, v_lista), (v_fora, v_lista);

  -- O cadastro pelo formulário: sem lista, com dono.
  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
    chave_dedup, telefone_hmac, status, candidato_origem_id)
  values (null, 'site', 'Cap Site', 'Cap', '5569230000901', '6923000901',
          'hmac-cap-901', 'na_fila', v_cand)
  returning id into v_site;

  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
    chave_dedup, telefone_hmac, status)
  values (v_lista, 'lista_fria', 'Cap Fria', 'Cap', '5569230000902', '6923000902',
          'hmac-cap-902', 'na_fila')
  returning id into v_fria;

  -- =========================================================================
  -- 1 · Ninguém marcado: os dois da chapa enxergam
  -- =========================================================================
  if public.recebe_captacao_de(v_a, v_cand) and public.recebe_captacao_de(v_b, v_cand) then
    raise notice '  ✅ 1. sem ninguém marcado, a chapa inteira recebe (é o de hoje)';
  else raise warning '  ❌ 1. lead preso sem ninguém marcado'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 2 · Quem não atende o candidato nunca recebe
  -- =========================================================================
  if not public.recebe_captacao_de(v_fora, v_cand) then
    raise notice '  ✅ 2. quem não atende o candidato não recebe o cadastro dele';
  else raise warning '  ❌ 2. VAZOU para fora da chapa'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 3 · ⚠️ MARCADO UM, O OUTRO PARA DE RECEBER
  -- =========================================================================
  update public.atendente_candidatos set recebe_captacao = true
   where atendente_id = v_a and candidato_id = v_cand;

  if public.recebe_captacao_de(v_a, v_cand) and not public.recebe_captacao_de(v_b, v_cand) then
    raise notice '  ✅ 3. marcado A, só A recebe';
  else raise warning '  ❌ 3. A ESCOLHA DO GESTOR NÃO VALEU: o cadastro continua caindo para todos';
       v_falhas := v_falhas + 1;
  end if;

  -- E marcar os dois devolve os dois.
  update public.atendente_candidatos set recebe_captacao = true
   where atendente_id = v_b and candidato_id = v_cand;
  if public.recebe_captacao_de(v_a, v_cand) and public.recebe_captacao_de(v_b, v_cand) then
    raise notice '  ✅ 3b. marcados os dois, os dois recebem';
  else raise warning '  ❌ 3b. seleção múltipla não funciona'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · ⚠️ DESMARCADO TODO MUNDO, VOLTA PARA A CHAPA
  -- =========================================================================
  update public.atendente_candidatos set recebe_captacao = false where candidato_id = v_cand;
  if public.recebe_captacao_de(v_a, v_cand) and public.recebe_captacao_de(v_b, v_cand) then
    raise notice '  ✅ 4. desmarcados todos, ninguém fica esperando: volta para a chapa';
  else raise warning '  ❌ 4. LEAD PRESO: quem pediu material não vai para ninguém';
       v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 5 · A fila de verdade obedece — não só a função de regra
  -- =========================================================================
  update public.atendente_candidatos set recebe_captacao = true
   where atendente_id = v_a and candidato_id = v_cand;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);

  if not exists (
    select 1 from jsonb_array_elements(public.fila_do_atendente(null, null, 50)->'linhas') x
     where (x->>'id')::uuid = v_site
  ) then
    raise notice '  ✅ 5. a fila de B não mostra mais o cadastro do site';
  else raise warning '  ❌ 5. fila_do_atendente ignorou a escolha'; v_falhas := v_falhas + 1;
  end if;

  -- Mas o contato de LISTA continua lá: a marca é só do formulário.
  if exists (
    select 1 from jsonb_array_elements(public.fila_do_atendente(null, null, 50)->'linhas') x
     where (x->>'id')::uuid = v_fria
  ) then
    raise notice '  ✅ 6. o contato de lista fria não é afetado pela marca';
  else raise warning '  ❌ 6. a marca vazou para a lista fria'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 7 · E quem foi escolhido pega mesmo
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  if exists (
    select 1 from jsonb_array_elements(public.fila_do_atendente(null, null, 50)->'linhas') x
     where (x->>'id')::uuid = v_site
  ) then
    raise notice '  ✅ 7. e a fila de A continua mostrando o cadastro do site';
  else raise warning '  ❌ 7. sumiu para quem foi escolhido'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'QUEM RECEBE O CADASTRO: ✅ as 8 passaram';
  else raise exception 'QUEM RECEBE O CADASTRO: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
