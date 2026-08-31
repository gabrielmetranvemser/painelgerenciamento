-- Grupos de lista: ligar e desligar um bloco, sem perder o que era de quem.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ OS TESTES 3 E 4 SÃO O CORAÇÃO. O grupo escreve em `listas.ativa` (ver o
-- cabeçalho da migration), e a armadilha dessa escolha é uma só: religar o
-- grupo não pode ressuscitar a lista que o gestor tinha pausado à mão. Se
-- ressuscitar, uma planilha que ele tirou do ar de propósito volta a entregar
-- contato sem ninguém mandar — e ele só descobre pelo atendente reclamando de
-- um número estranho.
--
-- O teste 7 vigia o outro lado: uma lista que ENTRA num grupo desligado não
-- pode continuar entregando dentro de um bloco que o gestor acha que está fora
-- do ar.
begin;

do $$
declare
  v_gestor uuid := gen_random_uuid();
  v_at     uuid := gen_random_uuid();
  v_g1     uuid;
  v_g2     uuid;
  v_la     uuid;  -- ativa, entra no grupo
  v_lb     uuid;  -- ativa, entra no grupo
  v_lc     uuid;  -- JÁ PAUSADA à mão antes do grupo
  v_ld     uuid;  -- fora de qualquer grupo
  v_r      jsonb;
  v_falhas int := 0;
begin
  raise notice '── Grupos de lista ──────────────────────────────────────────────────────';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_gestor, 'grupo-g@painel.local'), (v_at, 'grupo-a@painel.local')) as x(id, email);
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_gestor, 'gestor', 'GrupoG', true, now()),
         (v_at, 'atendente', 'GrupoA', true, now());

  insert into public.listas (origem, rotulo, entregue_por, entregue_em, ativa)
  values ('lista_fria', 'Grupo A', 'F', current_date, true)  returning id into v_la;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em, ativa)
  values ('lista_fria', 'Grupo B', 'F', current_date, true)  returning id into v_lb;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em, ativa)
  values ('lista_fria', 'Grupo C', 'F', current_date, false) returning id into v_lc;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em, ativa)
  values ('lista_fria', 'Grupo D', 'F', current_date, true)  returning id into v_ld;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);

  insert into public.grupos_lista (nome) values ('Teste Antigas') returning id into v_g1;
  insert into public.grupos_lista (nome) values ('Teste Novas')   returning id into v_g2;

  perform public.mover_lista_para_grupo(v_la, v_g1);
  perform public.mover_lista_para_grupo(v_lb, v_g1);
  perform public.mover_lista_para_grupo(v_lc, v_g1);

  if (select count(*) from public.listas where grupo_id = v_g1) = 3 then
    raise notice '  ✅ 1. três listas vinculadas ao grupo';
  else raise warning '  ❌ 1. vínculo falhou'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  v_r := public.alternar_grupo(v_g1, false);
  if (v_r->>'ok')::boolean and (v_r->>'listas_afetadas')::int = 2 then
    raise notice '  ✅ 2. desligar o grupo pausou as DUAS que estavam ativas (a terceira já estava)';
  else raise warning '  ❌ 2. %', v_r; v_falhas := v_falhas + 1;
  end if;

  if (select count(*) from public.listas where grupo_id = v_g1 and ativa) = 0 then
    raise notice '  ✅ 3. nenhuma lista do grupo entrega mais contato';
  else raise warning '  ❌ 3. sobrou lista ativa no grupo desligado'; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ O TESTE QUE IMPORTA.
  v_r := public.alternar_grupo(v_g1, true);
  if (select ativa from public.listas where id = v_la)
     and (select ativa from public.listas where id = v_lb)
     and not (select ativa from public.listas where id = v_lc) then
    raise notice '  ✅ 4. religar volta só as que o GRUPO pausou — a pausada à mão continua fora';
  else raise warning '  ❌ 4. RESSUSCITOU LISTA QUE O GESTOR TINHA PAUSADO'; v_falhas := v_falhas + 1;
  end if;

  if (select count(*) from public.listas
       where grupo_id = v_g1 and pausada_pelo_grupo) = 0 then
    raise notice '  ✅ 5. a marca de "pausada pelo grupo" é limpa ao religar';
  else raise warning '  ❌ 5. marca ficou pendurada'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · Lista fora do grupo não é tocada
  -- =========================================================================
  perform public.alternar_grupo(v_g1, false);
  if (select ativa from public.listas where id = v_ld) then
    raise notice '  ✅ 6. lista de fora do grupo não é afetada';
  else raise warning '  ❌ 6. mexeu em lista de outro grupo'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 7 · Entrar num grupo desligado desliga junto
  -- =========================================================================
  v_r := public.mover_lista_para_grupo(v_ld, v_g1);
  if (v_r->>'pausada')::boolean and not (select ativa from public.listas where id = v_ld) then
    raise notice '  ✅ 7. lista que entra num grupo desligado para de entregar na hora';
  else raise warning '  ❌ 7. ENTREGOU DENTRO DE GRUPO DESLIGADO: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- E sair dele a devolve.
  v_r := public.mover_lista_para_grupo(v_ld, null);
  if (v_r->>'religada')::boolean and (select ativa from public.listas where id = v_ld)
     and (select grupo_id from public.listas where id = v_ld) is null then
    raise notice '  ✅ 8. e sair do grupo devolve a lista ao ar';
  else raise warning '  ❌ 8. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 9 · Apagar o grupo não apaga lista nenhuma
  -- =========================================================================
  v_r := public.apagar_grupo(v_g1);
  if (v_r->>'ok')::boolean
     and (select count(*) from public.listas where id in (v_la, v_lb, v_lc)) = 3
     and (select count(*) from public.listas where id in (v_la, v_lb) and ativa) = 2
     and not (select ativa from public.listas where id = v_lc) then
    raise notice '  ✅ 9. apagar o grupo religa o que ele pausou e não apaga lista nenhuma';
  else raise warning '  ❌ 9. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 10 · Nome repetido e atendente
  -- =========================================================================
  begin
    insert into public.grupos_lista (nome) values ('teste novas');
    raise warning '  ❌ 10. aceitou nome repetido'; v_falhas := v_falhas + 1;
  exception when unique_violation then
    raise notice '  ✅ 10. nome de grupo repetido é recusado (mesmo com outra caixa)';
  end;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_at, 'role', 'authenticated')::text, true);
  v_r := public.alternar_grupo(v_g2, false);
  if v_r->>'motivo' = 'somente_gestor' then
    raise notice '  ✅ 11. atendente não liga nem desliga grupo';
  else raise warning '  ❌ 11. %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'GRUPOS DE LISTA: ✅ as 11 passaram';
  else raise exception 'GRUPOS DE LISTA: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
