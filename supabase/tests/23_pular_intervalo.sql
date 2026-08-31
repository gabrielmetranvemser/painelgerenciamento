-- Pular o intervalo: um pulo libera UMA conversa, e nada além disso.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ O TESTE 4 É O CORAÇÃO DO ARQUIVO. Se um pulo liberasse mais de uma
-- abordagem, "pular o intervalo" viraria "desligar o intervalo" — e o intervalo
-- é a trava que existe para o número do atendente não cair. A diferença entre
-- as duas coisas é uma linha de `update ... limit 1`, e é ela que este teste
-- vigia.
begin;

update public.config
   set hora_inicio = 0, hora_fim = 24, intervalo_seg = 120, teto_diario = 30
 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_uid    uuid := gen_random_uuid();
  v_chip   uuid;
  v_cand   uuid;
  v_lista  uuid;
  v_c      uuid[] := '{}';
  v_id     uuid;
  v_r      jsonb;
  v_falhas int := 0;
  i        int;
begin
  raise notice '── Pular intervalo ──────────────────────────────────────────────────────';

  update public.contatos set adiado_ate = now() + interval '1 day' where status = 'na_fila';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    'pulo@painel.local', extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', '');
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'Pulo', true, now());

  -- Chip ATIVO: fora da rampa, para o intervalo ser o da configuração.
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Pulo', 'ativo', 'ativo') returning id into v_chip;

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-pulo', 'Cand Pulo', 'deputado_federal', 1, '9981', 'RO', true)
  returning id into v_cand;
  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_uid, v_cand, 'deputado_federal', 1, true);

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Teste Pulo', 'F', current_date) returning id into v_lista;
  insert into public.atendente_listas (atendente_id, lista_id) values (v_uid, v_lista);

  for i in 1..4 loop
    insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
      chave_dedup, telefone_hmac, status, criado_em)
    values (v_lista, 'lista_fria', 'Pulo ' || i, 'Pulo', '556923000090' || i,
      '692300090' || i, 'hmac-pulo-090' || i, 'na_fila', now() - (5 - i) * interval '1 day')
    returning id into v_id;
    v_c := v_c || v_id;
  end loop;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- Primeira abordagem: liga o intervalo.
  update public.contatos set status = 'em_atendimento', atendente_id = v_uid, chip_id = v_chip,
    claimed_at = now(), claim_expira_em = now() + interval '10 min' where id = v_c[1];
  perform public.preparar_mensagem(v_c[1], v_chip, 'abertura');
  perform public.registrar_abertura(v_c[1], v_chip, 'abertura', 'oi');

  v_r := public.fila_status(v_chip);
  if v_r->>'motivo' = 'intervalo' and (v_r->>'intervalos_pulados_hoje')::int = 0
     and (v_r->>'pulo_guardado')::boolean is false then
    raise notice '  ✅ 1. o intervalo trava, e ainda não há pulo nenhum';
  else raise warning '  ❌ 1. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  v_r := public.pular_intervalo(v_chip);
  if (v_r->>'ok')::boolean and (v_r->>'pulos_hoje')::int = 1 then
    raise notice '  ✅ 2. o pulo é registrado, e a tela recebe a contagem para o aviso';
  else raise warning '  ❌ 2. %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.fila_status(v_chip);
  if (v_r->>'pode')::boolean and (v_r->>'pulo_guardado')::boolean
     and (v_r->>'segundos_espera')::int > 0 then
    raise notice '  ✅ 3. a fila libera, e ainda assim mostra que o intervalo corre';
  else raise warning '  ❌ 3. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · UM PULO, UMA CONVERSA
  -- =========================================================================
  update public.contatos set status = 'em_atendimento', atendente_id = v_uid, chip_id = v_chip,
    claimed_at = now(), claim_expira_em = now() + interval '10 min' where id = v_c[2];
  perform public.preparar_mensagem(v_c[2], v_chip, 'abertura');
  v_r := public.registrar_abertura(v_c[2], v_chip, 'abertura', 'oi 2');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 4a. a abordagem seguinte passa, gastando o pulo';
  else raise warning '  ❌ 4a. %', v_r; v_falhas := v_falhas + 1;
  end if;

  update public.contatos set status = 'em_atendimento', atendente_id = v_uid, chip_id = v_chip,
    claimed_at = now(), claim_expira_em = now() + interval '10 min' where id = v_c[3];
  perform public.preparar_mensagem(v_c[3], v_chip, 'abertura');
  v_r := public.registrar_abertura(v_c[3], v_chip, 'abertura', 'oi 3');
  if v_r->>'motivo' = 'intervalo' then
    raise notice '  ✅ 4b. e a TERCEIRA volta a esperar — um pulo não desliga o intervalo';
  else raise warning '  ❌ 4b. UM PULO LIBEROU MAIS DE UMA CONVERSA: %', v_r;
       v_falhas := v_falhas + 1;
  end if;

  if (select consumido_em is not null and interacao_id is not null
        from public.intervalos_pulados where chip_id = v_chip order by criado_em limit 1) then
    raise notice '  ✅ 5. o pulo fica marcado como gasto, e apontando a conversa que liberou';
  else raise warning '  ❌ 5. o rastro do pulo não fechou'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · Clicar duas vezes não acumula dois pulos
  -- =========================================================================
  perform public.pular_intervalo(v_chip);
  v_r := public.pular_intervalo(v_chip);
  if (v_r->>'ja_tinha')::boolean
     and (select count(*) from public.intervalos_pulados
           where chip_id = v_chip and consumido_em is null) = 1 then
    raise notice '  ✅ 6. clicar de novo com um pulo guardado não acumula outro';
  else raise warning '  ❌ 6. acumulou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 7 · Pular o intervalo NÃO pula mais nada
  -- =========================================================================
  -- Dia bloqueado é regra eleitoral, não risco que o atendente assume.
  insert into public.dias_bloqueados (data, motivo)
  values (public.hoje_operacional(), 'Teste') on conflict do nothing;
  v_r := public.pular_intervalo(v_chip);
  if v_r->>'motivo' = 'dia_bloqueado' then
    raise notice '  ✅ 7. no dia bloqueado não se pula nada';
  else raise warning '  ❌ 7. %', v_r; v_falhas := v_falhas + 1;
  end if;
  delete from public.dias_bloqueados where data = public.hoje_operacional();

  update public.chips set status = 'pausado' where id = v_chip;
  v_r := public.pular_intervalo(v_chip);
  if v_r->>'motivo' = 'chip_indisponivel' then
    raise notice '  ✅ 8. número pausado também não';
  else raise warning '  ❌ 8. %', v_r; v_falhas := v_falhas + 1;
  end if;
  update public.chips set status = 'ativo' where id = v_chip;

  -- =========================================================================
  -- 9 · O gestor fica sabendo, do terceiro em diante
  -- =========================================================================
  delete from public.intervalos_pulados where chip_id = v_chip;
  delete from public.alertas where chip_id = v_chip;
  perform public.pular_intervalo(v_chip);
  update public.intervalos_pulados set consumido_em = now() where chip_id = v_chip;
  perform public.pular_intervalo(v_chip);
  update public.intervalos_pulados set consumido_em = now() where chip_id = v_chip;

  if not exists (select 1 from public.alertas
                  where chip_id = v_chip and tipo = 'intervalo_pulado') then
    raise notice '  ✅ 9. dois pulos não viram alerta — um pulo é acidente';
  else raise warning '  ❌ 9. alertou cedo demais'; v_falhas := v_falhas + 1;
  end if;

  perform public.pular_intervalo(v_chip);
  if exists (select 1 from public.alertas
              where chip_id = v_chip and tipo = 'intervalo_pulado') then
    raise notice '  ✅ 10. o terceiro vira alerta para o gestor';
  else raise warning '  ❌ 10. não alertou'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 11 · O chip de outro atendente não se pula
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  v_r := public.pular_intervalo(v_chip);
  if v_r->>'motivo' = 'chip_nao_e_seu' then
    raise notice '  ✅ 11. ninguém pula o intervalo do número de outro';
  else raise warning '  ❌ 11. %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'PULAR INTERVALO: ✅ as 11 passaram';
  else raise exception 'PULAR INTERVALO: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
