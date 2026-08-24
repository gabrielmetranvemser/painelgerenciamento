-- Cadastro de quem chamou o atendente, e o endereço de entrega em partes.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

do $$
declare
  v_uid    uuid := gen_random_uuid();
  v_outro  uuid := gen_random_uuid();
  v_chip   uuid;
  v_chip2  uuid;
  v_cand   uuid;
  v_id     uuid;
  v_r      jsonb;
  v_cap    record;
  v_status text;
  v_origem text;
  v_falhas int := 0;
begin
  raise notice '── Adicionar contato e endereço estruturado ─────────────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_uid, 'add@painel.local'), (v_outro, 'add-outro@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'Cadastrador', true, now()),
         (v_outro, 'atendente', 'Outra', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Add', 'ativo', 'ativo') returning id into v_chip;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_outro, 'Chip Outra', 'ativo', 'ativo') returning id into v_chip2;

  insert into public.candidatos (slug, nome_urna, cargo, numero, ativo)
  values ('add-teste', 'Teste Add', 'deputado_estadual', '10111', true)
  returning id into v_cand;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- ── 1. Contato novo nasce QUENTE, na mão de quem cadastrou ───────────────
  v_r := public.adicionar_contato(
    'Maria da Silva', '5569300000901', '6930000901', 'hmac-add-0901', 1, v_chip, null, v_cand);

  if (v_r->>'ok')::boolean
     and v_r->'contato'->>'origem' = 'chamou'
     and v_r->'contato'->>'status' = 'em_atendimento'
     and v_r->'contato'->>'primeiro_nome' = 'Maria'
  then
    raise notice '  ✅ 1. contato novo entra como ''chamou'', em atendimento, com primeiro nome';
  else raise warning '  ❌ 1. %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_id := (v_r->'contato'->>'id')::uuid;

  -- ── 2. O candidato já entra na lista de quem pode alcançar a pessoa ──────
  -- Sem isto a tela ofereceria um material que o servidor recusaria a enviar.
  if exists (select 1 from public.contato_candidato
              where contato_id = v_id and candidato_id = v_cand) then
    raise notice '  ✅ 2. a permissão do candidato pedido já está gravada';
  else raise warning '  ❌ 2. contato_candidato não foi gravado'; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. Cadastrar o MESMO número de novo não duplica ──────────────────────
  -- Duplicar aqui é o caminho mais curto para dois atendentes na mesma pessoa.
  v_r := public.adicionar_contato(
    'Maria da Silva', '5569300000901', '6930000901', 'hmac-add-0901', 1, v_chip, null, v_cand);

  if (v_r->>'ok')::boolean
     and (v_r->>'ja_existia')::boolean
     and (v_r->'contato'->>'id')::uuid = v_id
     and (select count(*) from public.contatos where telefone_hmac = 'hmac-add-0901') = 1
  then
    raise notice '  ✅ 3. cadastrar de novo devolve o MESMO contato, sem duplicar';
  else raise warning '  ❌ 3. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. Número que já é de OUTRO atendente não muda de dono ───────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_outro, 'role', 'authenticated')::text, true);

  v_r := public.adicionar_contato(
    'Maria', '5569300000901', '6930000901', 'hmac-add-0901', 1, v_chip2, null, null);

  select atendente_id::text into v_status from public.contatos where id = v_id;

  if not (v_r->>'ok')::boolean
     and v_r->>'motivo' = 'ja_e_de_outro_atendente'
     and v_r->>'atendente' = 'Cadastrador'
     and v_status = v_uid::text
  then
    raise notice '  ✅ 4. contato de outro atendente é recusado, com o nome de quem atende';
  else raise warning '  ❌ 4. %', v_r; v_falhas := v_falhas + 1;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- ── 5. Número bloqueado é recusado, e o gestor é avisado ─────────────────
  insert into public.bloqueios (telefone_hmac, motivo, origem, apagar_em)
  values ('hmac-add-0902', 'teste', 'landing', now() + interval '48 hours');

  v_r := public.adicionar_contato(
    'Quem Saiu', '5569300000902', '6930000902', 'hmac-add-0902', 1, v_chip, null, null);

  if not (v_r->>'ok')::boolean
     and v_r->>'motivo' = 'numero_bloqueado'
     and not exists (select 1 from public.contatos where telefone_hmac = 'hmac-add-0902')
     and exists (select 1 from public.alertas
                  where tipo = 'cadastro_de_bloqueado_recusado' and atendente_id = v_uid)
  then
    raise notice '  ✅ 5. quem pediu saída não volta pelo botão, e fica alerta para o gestor';
  else raise warning '  ❌ 5. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Contato da lista fria sem dono passa a ser dele, SEM perder a origem ──
  -- A frase de {{origem}} é a divulgação de como obtivemos o número. Trocar
  -- para 'chamou' calaria o "um apoiador me passou seu contato".
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Lista do teste', 'Fulano', current_date);

  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup, telefone_hmac, status)
  values ((select id from public.listas where rotulo = 'Lista do teste'),
          'lista_fria', 'Da Lista', '5569300000903', '6930000903', 'hmac-add-0903', 'na_fila');

  v_r := public.adicionar_contato(
    'Da Lista', '5569300000903', '6930000903', 'hmac-add-0903', 1, v_chip, null, null);

  select origem::text, status::text into v_origem, v_status
    from public.contatos where telefone_hmac = 'hmac-add-0903';

  if (v_r->>'ok')::boolean and v_origem = 'lista_fria' and v_status = 'em_atendimento' then
    raise notice '  ✅ 6. contato de lista vira dele, mas a origem continua ''lista_fria''';
  else raise warning '  ❌ 6. origem=% status=% r=%', v_origem, v_status, v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. Contato SEM lista e sem dono vira 'chamou' ────────────────────────
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status)
  values ('site', 'Sem Dono', '5569300000904', '6930000904', 'hmac-add-0904', 'na_fila');

  v_r := public.adicionar_contato(
    'Sem Dono', '5569300000904', '6930000904', 'hmac-add-0904', 1, v_chip, null, null);

  select origem::text into v_origem from public.contatos where telefone_hmac = 'hmac-add-0904';

  if (v_r->>'ok')::boolean and v_origem = 'chamou' then
    raise notice '  ✅ 7. contato sem lista passa a ''chamou'' — agora é verdade';
  else raise warning '  ❌ 7. origem=% r=%', v_origem, v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 8. Sem termo aceito não cadastra ─────────────────────────────────────
  -- Mesma porta da fila: o botão não pode ser a saída pelos fundos.
  update public.usuarios set termo_aceito_em = null where id = v_uid;

  v_r := public.adicionar_contato(
    'Nao Vai', '5569300000905', '6930000905', 'hmac-add-0905', 1, v_chip, null, null);

  if not (v_r->>'ok')::boolean and v_r->>'motivo' = 'termo_nao_aceito' then
    raise notice '  ✅ 8. sem termo aceito o botão recusa';
  else raise warning '  ❌ 8. %', v_r; v_falhas := v_falhas + 1;
  end if;

  update public.usuarios set termo_aceito_em = now() where id = v_uid;

  -- ── 9. O pedido de kit grava as partes E a linha montada ─────────────────
  -- A linha é o que a exportação e a busca de entregas leem; as partes são o
  -- que deixa a rota ser ordenada por bairro.
  perform public.registrar_abertura(v_id, v_chip, 'permissao', 'oi', null);

  v_r := public.registrar_pedido_kit(
    v_id, array['santinho', 'camiseta'],
    'Rua das Flores, 123 — Centro · CEP 76801-000',
    '76801000', 'Rua das Flores', '123', 'Centro', 'G', null);

  select cep, rua, numero, bairro, tamanho_camiseta, endereco into v_cap
    from public.captacoes where contato_id = v_id;

  if (v_r->>'ok')::boolean
     and v_cap.cep = '76801000' and v_cap.bairro = 'Centro'
     and v_cap.numero = '123' and v_cap.tamanho_camiseta = 'G'
     and v_cap.endereco like 'Rua das Flores%'
  then
    raise notice '  ✅ 9. o pedido de kit grava as partes e a linha montada';
  else raise warning '  ❌ 9. %', to_jsonb(v_cap); v_falhas := v_falhas + 1;
  end if;

  -- ── 10. CEP torto entra como nulo, o pedido continua valendo ─────────────
  -- Perder o pedido por causa de um campo opcional é trocar o problema grande
  -- pelo pequeno.
  v_r := public.registrar_pedido_kit(
    v_id, array['adesivo'], 'Linha 25, km 8 — Zona Rural',
    'não sei', 'Linha 25, km 8', 'S/N', 'Zona Rural', null, null);

  select cep, bairro into v_cap from public.captacoes where contato_id = v_id;

  if (v_r->>'ok')::boolean and v_cap.cep is null and v_cap.bairro = 'Zona Rural' then
    raise notice '  ✅ 10. CEP inválido vira nulo sem derrubar o pedido';
  else raise warning '  ❌ 10. %', to_jsonb(v_cap); v_falhas := v_falhas + 1;
  end if;

  -- ── 11. O histórico devolve o endereço em partes ─────────────────────────
  v_r := public.historico_contato(v_id);
  if (v_r->>'ok')::boolean
     and v_r->'pedido_kit'->>'bairro' = 'Zona Rural'
     and v_r->'pedido_kit'->>'numero' = 'S/N'
  then
    raise notice '  ✅ 11. o histórico devolve as partes para reabrir o formulário';
  else raise warning '  ❌ 11. %', v_r->'pedido_kit'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice '  ADICIONAR CONTATO: tudo verde ✅';
  else raise exception 'ADICIONAR CONTATO: ❌ % falharam', v_falhas;
  end if;
end $$;

rollback;
