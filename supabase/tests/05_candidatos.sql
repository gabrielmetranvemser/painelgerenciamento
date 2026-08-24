-- A regra "um candidato por cargo, dois senadores".
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
  v_uid  uuid := gen_random_uuid();
  v_uid2 uuid := gen_random_uuid();
  v_falhas int := 0;
  v_gov uuid; v_fed1 uuid; v_fed2 uuid; v_est uuid;
  v_sen1 uuid; v_sen2 uuid; v_sen3 uuid; v_pres uuid;

  procedure_checa boolean;
begin
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    'cand@painel.local', extensions.crypt('x', extensions.gen_salt('bf')),
    now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
  );
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'Cand', true, now());

  -- Um segundo atendente, SEM nenhuma atribuição: é nele que dá para testar a
  -- chave estrangeira composta isoladamente. No primeiro, todos os cargos já
  -- estão ocupados e a restrição de unicidade dispararia antes da FK.
  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid2, 'authenticated', 'authenticated',
    'cand2@painel.local', extensions.crypt('x', extensions.gen_salt('bf')),
    now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
  );
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid2, 'atendente', 'Cand2', true, now());

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero) values
    ('gov-teste',  'Gov Teste',  'governador',        1, '11') returning id into v_gov;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero) values
    ('fed-um',     'Fed Um',     'deputado_federal',  1, '1111') returning id into v_fed1;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero) values
    ('fed-dois',   'Fed Dois',   'deputado_federal',  1, '2222') returning id into v_fed2;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero) values
    ('est-teste',  'Est Teste',  'deputado_estadual', 1, '11111') returning id into v_est;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero) values
    ('sen-um',     'Sen Um',     'senador',           1, '111') returning id into v_sen1;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero) values
    ('sen-dois',   'Sen Dois',   'senador',           2, '222') returning id into v_sen2;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero) values
    ('sen-tres',   'Sen Tres',   'senador',           1, '333') returning id into v_sen3;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero) values
    ('pres-teste', 'Pres Teste', 'presidente',        1, '99') returning id into v_pres;

  -- ── 1. A chapa completa cabe ──────────────────────────────────────────────
  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal) values
    (v_uid, v_fed1, 'deputado_federal',  1, true),
    (v_uid, v_est,  'deputado_estadual', 1, false),
    (v_uid, v_gov,  'governador',        1, false),
    (v_uid, v_sen1, 'senador',           1, false),
    (v_uid, v_sen2, 'senador',           2, false),
    (v_uid, v_pres, 'presidente',        1, false);

  if (select count(*) from public.atendente_candidatos where atendente_id = v_uid) = 6 then
    raise notice '  ✅ 1. um federal, um estadual, um governador, DOIS senadores e um presidente';
  else raise warning '  ❌ 1. a chapa completa não coube'; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. Segundo deputado federal é recusado ────────────────────────────────
  begin
    insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga)
    values (v_uid, v_fed2, 'deputado_federal', 1);
    raise warning '  ❌ 2. aceitou DOIS deputados federais para o mesmo atendente';
    v_falhas := v_falhas + 1;
  exception when unique_violation then
    raise notice '  ✅ 2. segundo deputado federal recusado pelo banco';
  end;

  -- ── 3. Terceiro senador é recusado ────────────────────────────────────────
  -- São duas vagas, então a 1ª já está ocupada.
  begin
    insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga)
    values (v_uid, v_sen3, 'senador', 1);
    raise warning '  ❌ 3. aceitou um TERCEIRO senador';
    v_falhas := v_falhas + 1;
  exception when unique_violation then
    raise notice '  ✅ 3. terceiro senador recusado: só existem duas vagas';
  end;

  -- ── 4. A atribuição não pode mentir sobre o cargo do candidato ────────────
  -- Sem a chave estrangeira composta, dava para cadastrar o governador
  -- declarando que ele é senador e furar a regra por fora.
  begin
    insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga)
    values (v_uid2, v_fed2, 'senador', 2);
    raise warning '  ❌ 4. deixou declarar cargo errado na atribuição';
    v_falhas := v_falhas + 1;
  exception when foreign_key_violation then
    raise notice '  ✅ 4. não dá para declarar um cargo que não é o do candidato';
  end;

  -- ── 5. Dois principais é recusado ─────────────────────────────────────────
  begin
    update public.atendente_candidatos set principal = true
     where atendente_id = v_uid and candidato_id = v_gov;
    raise warning '  ❌ 5. aceitou dois candidatos principais';
    v_falhas := v_falhas + 1;
  exception when unique_violation then
    raise notice '  ✅ 5. só um candidato principal por atendente';
  end;

  -- ── 6. Número com dígitos errados para o cargo ────────────────────────────
  begin
    insert into public.candidatos (slug, nome_urna, cargo, numero)
    values ('errado', 'Errado', 'deputado_federal', '12345');
    raise warning '  ❌ 6. aceitou federal com 5 dígitos';
    v_falhas := v_falhas + 1;
  exception when check_violation then
    raise notice '  ✅ 6. federal com 5 dígitos recusado (federal tem 4)';
  end;

  -- ── 7. Segunda vaga em cargo que não é senador ────────────────────────────
  begin
    insert into public.candidatos (slug, nome_urna, cargo, vaga, numero)
    values ('gov2', 'Gov Dois', 'governador', 2, '22');
    raise warning '  ❌ 7. aceitou 2ª vaga de governador';
    v_falhas := v_falhas + 1;
  exception when check_violation then
    raise notice '  ✅ 7. só senador tem 2ª vaga';
  end;

  -- ── 8. Slug precisa servir de endereço ────────────────────────────────────
  begin
    insert into public.candidatos (slug, nome_urna, cargo, numero)
    values ('Slug Com Espaço', 'X', 'presidente', '11');
    raise warning '  ❌ 8. aceitou slug inválido';
    v_falhas := v_falhas + 1;
  exception when check_violation then
    raise notice '  ✅ 8. slug com espaço ou maiúscula recusado';
  end;

  if v_falhas > 0 then raise exception 'CANDIDATOS: ❌ % falha(s)', v_falhas; end if;
  raise notice 'CANDIDATOS: ✅ as 8 passaram';
end $$;

rollback;
