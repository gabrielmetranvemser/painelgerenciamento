-- Escolher qual contato atender: a listagem e a tomada de um contato específico.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ ESTE ARQUIVO EXISTE PORQUE FALTOU. `fila_do_atendente` foi para produção
-- sem nenhum teste que a CHAMASSE, e tinha um erro que a derrubava sempre:
-- `jsonb_agg(x order by x.ordem)`, onde `x` é a coluna jsonb e não a tabela.
-- Quebrava com três contatos ou com trinta mil; na tela virou "carregando…"
-- para sempre, e passou por lentidão da base.
--
-- A lição, e o motivo de o primeiro teste ser tão bobo: função nova precisa de
-- pelo menos UMA chamada num teste. Compilar não é rodar.
begin;

update public.config set hora_inicio = 0, hora_fim = 24, intervalo_seg = 0 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_chip_a uuid;
  v_chip_b uuid;
  v_cand   uuid;
  v_l1     uuid;
  v_l2     uuid;
  v_c1     uuid;
  v_c2     uuid;
  v_c3     uuid;
  v_r      jsonb;
  v_linhas jsonb;
  v_falhas int := 0;
begin
  raise notice '── Escolher contato ─────────────────────────────────────────────────────';

  -- Tira a base REAL de circulação durante a transação.
  update public.contatos set adiado_ate = now() + interval '1 day' where status = 'na_fila';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_a, 'esc-a@painel.local'), (v_b, 'esc-b@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_a, 'atendente', 'EscA', true, now()),
         (v_b, 'atendente', 'EscB', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_a, 'Chip Esc A', 'ativo', 'ativo') returning id into v_chip_a;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_b, 'Chip Esc B', 'ativo', 'ativo') returning id into v_chip_b;

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-esc-cand', 'Cand Esc', 'deputado_federal', 1, '9991', 'RO', true)
  returning id into v_cand;

  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_a, v_cand, 'deputado_federal', 1, true),
         (v_b, v_cand, 'deputado_federal', 1, true);

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Teste Esc 1', 'Fulano', current_date) returning id into v_l1;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Teste Esc 2', 'Fulano', current_date) returning id into v_l2;

  -- Os DOIS atendem a L1. Ninguém atende a L2.
  --
  -- ⚠️ B precisa ter lista: sem ela, `fila_status` recusa antes com `sem_lista`
  -- e os testes 9 e 10 mediriam a configuração de B em vez da trava por contato
  -- que eles existem para provar.
  insert into public.atendente_listas (atendente_id, lista_id)
  values (v_a, v_l1), (v_b, v_l1);

  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
                               chave_dedup, telefone_hmac, status, criado_em)
  values (v_l1, 'lista_fria', 'Esc Antonio', 'Esc', '5569230000901', '6923000901',
          'hmac-esc-0901', 'na_fila', now() - interval '3 days')
  returning id into v_c1;

  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
                               chave_dedup, telefone_hmac, status, criado_em)
  values (v_l1, 'lista_fria', 'Esc Beatriz', 'Esc', '5569230000902', '6923000902',
          'hmac-esc-0902', 'na_fila', now() - interval '2 days')
  returning id into v_c2;

  -- Este é da lista que NINGUÉM atende.
  insert into public.contatos (lista_id, origem, nome, telefone_e164,
                               chave_dedup, telefone_hmac, status, criado_em)
  values (v_l2, 'lista_fria', 'Esc Fora', '5569230000903', '6923000903',
          'hmac-esc-0903', 'na_fila', now() - interval '1 day')
  returning id into v_c3;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 1 · A listagem RESPONDE (o teste que faltava)
  -- =========================================================================
  v_r := public.fila_do_atendente(null, null, 40);
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 1. a listagem responde sem erro';
  else raise warning '  ❌ 1. a listagem falhou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_linhas := v_r->'linhas';
  if jsonb_array_length(v_linhas) = 2 then
    raise notice '  ✅ 2. traz os 2 da lista dele, e só eles';
  else raise warning '  ❌ 2. linhas: %', jsonb_array_length(v_linhas); v_falhas := v_falhas + 1;
  end if;

  -- Mais antigo primeiro, igual à ordem que "Buscar próximo" usa.
  if v_linhas->0->>'id' = v_c1::text then
    raise notice '  ✅ 3. na mesma ordem da fila — o mais antigo primeiro';
  else raise warning '  ❌ 3. ordem errada: %', v_linhas->0; v_falhas := v_falhas + 1;
  end if;

  -- O telefone vem, a pedido de quem opera. Ver o cabeçalho da migration
  -- `corrigir_fila_do_atendente`.
  if v_linhas->0->>'telefone_e164' = '5569230000901' then
    raise notice '  ✅ 4. com o telefone, para o atendente reconhecer quem procura';
  else raise warning '  ❌ 4. sem telefone: %', v_linhas->0; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ O contato da lista que ninguém atende NÃO pode aparecer. A listagem tem
  -- de usar o mesmo critério de quem entrega — senão ela oferece gente que a
  -- fila depois recusa.
  if not exists (
    select 1 from jsonb_array_elements(v_linhas) e where e->>'id' = v_c3::text
  ) then
    raise notice '  ✅ 5. contato de lista que não é dele fica de fora';
  else raise warning '  ❌ 5. ofereceu contato de outra lista'; v_falhas := v_falhas + 1;
  end if;

  -- Busca por nome.
  v_r := public.fila_do_atendente(null, 'beatriz', 40);
  if jsonb_array_length(v_r->'linhas') = 1
     and v_r->'linhas'->0->>'id' = v_c2::text then
    raise notice '  ✅ 6. a busca pelo nome acha';
  else raise warning '  ❌ 6. busca: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Lista que não é dele é recusada — não devolve lista vazia fingindo normal.
  v_r := public.fila_do_atendente(v_l2, null, 40);
  if v_r->>'erro' = 'lista_nao_e_sua' then
    raise notice '  ✅ 7. pedir a lista de outro é recusado';
  else raise warning '  ❌ 7. deixou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 2 · Pegar um contato ESCOLHIDO
  -- =========================================================================
  -- O mais NOVO, de propósito: é o que prova que escolher muda o critério.
  v_r := public.pegar_contato_especifico(v_c2, v_chip_a);
  if (v_r->>'ok')::boolean and (v_r->'contato'->>'id')::uuid = v_c2 then
    raise notice '  ✅ 8. entrega o contato escolhido, e não o primeiro da fila';
  else raise warning '  ❌ 8. não entregou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ Escolher NÃO afrouxa nada. Contato de lista que não é dele é recusado
  -- com um motivo só — a tela não pode virar um oráculo sobre o que existe na
  -- base fora do alcance de quem pergunta.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);

  v_r := public.pegar_contato_especifico(v_c3, v_chip_b);
  if v_r->>'motivo' = 'contato_indisponivel' then
    raise notice '  ✅ 9. contato de lista alheia é recusado';
  else raise warning '  ❌ 9. entregou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- E contato que já está na mão de outro também.
  v_r := public.pegar_contato_especifico(v_c2, v_chip_b);
  if v_r->>'motivo' = 'contato_indisponivel' then
    raise notice '  ✅ 10. contato já na mão de um colega é recusado';
  else raise warning '  ❌ 10. roubou o contato: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Quem está com um contato na mão recebe ELE de volta, mesmo pedindo outro:
  -- a conversa aberta merece o fim, e é a mesma trava de `pegar_proximo`.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  v_r := public.pegar_contato_especifico(v_c1, v_chip_a);
  if (v_r->>'retomada')::boolean and (v_r->'contato'->>'id')::uuid = v_c2 then
    raise notice '  ✅ 11. com um contato na mão, escolher outro devolve o que está aberto';
  else raise warning '  ❌ 11. largou o contato aberto: %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'ESCOLHER CONTATO: ✅ as 11 passaram';
  else raise exception 'ESCOLHER CONTATO: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
