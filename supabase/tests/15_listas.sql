-- Listas por atendente: quem recebe o quê.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

-- ⚠️ A janela de horário abre para o teste inteiro (revertida pelo rollback).
update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_chip_a uuid;
  v_chip_b uuid;
  v_l1     uuid;
  v_l2     uuid;
  v_c1     uuid;
  v_c2     uuid;
  v_c3     uuid;
  v_c4     uuid;
  v_cap    uuid;
  v_linhas int;
  v_r      jsonb;
  v_f      jsonb;
  v_falhas int := 0;
begin
  raise notice '── Listas por atendente ─────────────────────────────────────────────────';

  -- ⚠️ Tira a base REAL de circulação durante a transação.
  --
  -- Sem isto o teste dependeria do que já está importado no banco: um contato
  -- de verdade na frente da fila entraria no lugar do contato do teste, e a
  -- asserção falharia por motivo nenhum. `adiado_ate` é o mecanismo que o
  -- próprio sistema usa para "fora de circulação", e o rollback desfaz tudo.
  update public.contatos set adiado_ate = now() + interval '1 day' where status = 'na_fila';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_a, 'listas-a@painel.local'), (v_b, 'listas-b@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_a, 'atendente', 'ListaA', true, now()),
         (v_b, 'atendente', 'ListaB', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_a, 'Chip Lista A', 'ativo', 'ativo') returning id into v_chip_a;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_b, 'Chip Lista B', 'ativo', 'ativo') returning id into v_chip_b;

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Teste L1', 'Fulano', current_date) returning id into v_l1;
  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Teste L2', 'Fulano', current_date) returning id into v_l2;

  -- Dois contatos na L1 (o c1 mais antigo), um na L2, e um de captação, que não
  -- pertence a lista nenhuma.
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
  values (v_l1, 'lista_fria', 'L1 Um', '5569200000901', '6920000901', 'hmac-lista-0901', 'na_fila', now() - interval '3 days')
  returning id into v_c1;
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
  values (v_l1, 'lista_fria', 'L1 Dois', '5569200000902', '6920000902', 'hmac-lista-0902', 'na_fila', now() - interval '2 days')
  returning id into v_c2;
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
  values (v_l2, 'lista_fria', 'L2 Um', '5569200000903', '6920000903', 'hmac-lista-0903', 'na_fila', now() - interval '1 day')
  returning id into v_c3;
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
  values ('site', 'Captacao', '5569200000904', '6920000904', 'hmac-lista-0904', 'na_fila', now())
  returning id into v_cap;
  -- Reservado para os testes do modo manual, lá embaixo: entra por último na
  -- ordem da fila para não atrapalhar os de cima.
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
  values (v_l1, 'lista_fria', 'L1 Tres', '5569200000905', '6920000905', 'hmac-lista-0905', 'na_fila', now())
  returning id into v_c4;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- ── 1. Sem lista marcada, contato de lista não conta ─────────────────────
  -- Quem se cadastrou sozinho continua contando: ele PEDIU para ser chamado e
  -- não pertence a lista nenhuma.
  v_f := public.fila_status(v_chip_a);
  if (v_f->>'frios_na_fila')::int = 0 and (v_f->>'quentes_na_fila')::int = 1 then
    raise notice '  ✅ 1. sem lista marcada: 0 de lista, mas a captação continua na fila';
  else raise warning '  ❌ 1. contadores errados sem lista: %', v_f; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. Marcar a lista põe os contatos dela na fila ───────────────────────
  insert into public.atendente_listas (atendente_id, lista_id) values (v_a, v_l1);

  v_f := public.fila_status(v_chip_a);
  if (v_f->>'frios_na_fila')::int = 3 then
    raise notice '  ✅ 2. marcada a L1, os 3 contatos dela entram na fila do atendente';
  else raise warning '  ❌ 2. a lista marcada não entrou: %', v_f; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. A lista de OUTRO não vaza ─────────────────────────────────────────
  -- A L2 não está marcada para ninguém: o contato dela não pode aparecer na
  -- conta de quem tem só a L1.
  if (v_f->>'frios_na_fila')::int = 3 then
    raise notice '  ✅ 3. o contato da L2, que ninguém atende, fica fora';
  else raise warning '  ❌ 3. contato de lista não marcada entrou na conta'; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. Lista pausada some da fila, mesmo marcada ─────────────────────────
  update public.listas set ativa = false where id = v_l1;
  v_f := public.fila_status(v_chip_a);
  if (v_f->>'frios_na_fila')::int = 0 then
    raise notice '  ✅ 4. pausar a lista tira os contatos dela da fila na hora';
  else raise warning '  ❌ 4. lista pausada continuou entregando: %', v_f; v_falhas := v_falhas + 1;
  end if;
  update public.listas set ativa = true where id = v_l1;

  -- ── 5. O claim entrega o que o contador prometeu ─────────────────────────
  -- Quente antes de frio: a captação vem primeiro. Depois de pulada, ela sai de
  -- circulação e a vez é do mais antigo da L1.
  v_r := public.pegar_proximo_contato(v_chip_a);
  if v_r->'contato'->>'id' = v_cap::text then
    perform public.pular_contato(v_cap, v_chip_a);
    v_r := public.pegar_proximo_contato(v_chip_a);
    if v_r->'contato'->>'id' = v_c1::text then
      raise notice '  ✅ 5. entrega a captação primeiro e depois o mais antigo da lista marcada';
    else raise warning '  ❌ 5. não entregou o contato da lista: %', v_r; v_falhas := v_falhas + 1;
    end if;
  else raise warning '  ❌ 5. a captação não veio primeiro: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Quem não tem lista ouve "sem_lista", não "fila_vazia" ─────────────
  -- São duas frases que mandam o atendente para lugares diferentes: uma manda
  -- parar, a outra manda falar com o gestor.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);

  v_f := public.fila_status(v_chip_b);
  if v_f->>'motivo' = 'sem_lista' then
    raise notice '  ✅ 6. atendente sem lista recebe o motivo sem_lista';
  else raise warning '  ❌ 6. motivo errado para quem não tem lista: %', v_f; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. A mesma lista em dois atendentes é dividida ───────────────────────
  -- É o caso que originou a funcionalidade: a lista grande fica com os dois, e
  -- ninguém fala com a mesma pessoa duas vezes.
  insert into public.atendente_listas (atendente_id, lista_id) values (v_b, v_l1);

  v_r := public.pegar_proximo_contato(v_chip_b);
  if v_r->'contato'->>'id' = v_c2::text then
    raise notice '  ✅ 7. a lista compartilhada entrega o PRÓXIMO, não o que já está com o colega';
  else raise warning '  ❌ 7. entregou o contato errado ao segundo atendente: %', v_r;
    v_falhas := v_falhas + 1;
  end if;

  -- ── 8. Tirar a lista não arranca o contato da mão ────────────────────────
  -- A pessoa do outro lado já foi abordada; sumir no meio é pior que terminar.
  delete from public.atendente_listas where atendente_id = v_a and lista_id = v_l1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  v_r := public.pegar_proximo_contato(v_chip_a);
  if (v_r->>'retomada')::boolean and v_r->'contato'->>'id' = v_c1::text then
    raise notice '  ✅ 8. contato já na mão continua com quem o pegou, mesmo sem a lista';
  else raise warning '  ❌ 8. o contato em atendimento se perdeu: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 9. `minhas_listas` só mostra lista ativa e do próprio atendente ──────
  -- É o cardápio da tela do atendente. Mostrar uma lista pausada ali seria
  -- oferecer um botão que a fila recusa no clique seguinte.
  insert into public.atendente_listas (atendente_id, lista_id) values (v_a, v_l1);

  select count(*) into v_linhas from public.minhas_listas();
  if v_linhas = 1 and (select na_fila from public.minhas_listas() limit 1) = 1 then
    raise notice '  ✅ 9. minhas_listas devolve só a L1, com 1 contato ainda esperando';
  else raise warning '  ❌ 9. minhas_listas errado: % linha(s)', v_linhas; v_falhas := v_falhas + 1;
  end if;

  update public.listas set ativa = false where id = v_l1;
  select count(*) into v_linhas from public.minhas_listas();
  if v_linhas = 0 then
    raise notice '  ✅ 9b. lista pausada some do cardápio do atendente';
  else raise warning '  ❌ 9b. lista pausada continuou no cardápio'; v_falhas := v_falhas + 1;
  end if;
  update public.listas set ativa = true where id = v_l1;

  -- ── 10. Trabalhar UMA lista entrega só dela ──────────────────────────────
  -- Nem a captação entra: quem escolheu "a lista do bairro" não quer receber
  -- gente de fora dela no meio.
  perform public.pular_contato(v_c1, v_chip_a);
  update public.contatos set adiado_ate = null where id = v_cap;

  -- O contato chega etiquetado: é o que a tela do atendente mostra ao lado do
  -- nome, e sem isso quem atende três listas não sabe de qual veio.
  v_r := public.pegar_proximo_contato(v_chip_a, v_l1);
  if v_r->'contato'->>'id' = v_c4::text
     and v_r->'contato'->>'lista' = 'Teste L1'
     and v_r->'contato'->>'lista_id' = v_l1::text then
    raise notice '  ✅ 10. escolhida uma lista, vem contato DELA e já etiquetado — nem a captação fura a fila';
  else raise warning '  ❌ 10. o modo manual entregou outra coisa: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 11. A lista escolhida é conferida no SERVIDOR ────────────────────────
  -- A escolha chega do navegador; sem esta trava bastava trocar um id no
  -- DevTools para puxar a carteira do colega.
  --
  -- ⚠️ O contato precisa sair da mão antes: com um contato reservado, a fila
  -- devolve ELE, aconteça o que acontecer com o resto do pedido — é a trava que
  -- impede recarregar a página de pular alguém, e ela vem primeiro de
  -- propósito. Sem soltar, este teste mediria aquela regra, não esta.
  perform public.pular_contato(v_c4, v_chip_a);

  v_f := public.fila_status(v_chip_a, v_l2);
  v_r := public.pegar_proximo_contato(v_chip_a, v_l2);
  if v_f->>'motivo' = 'lista_nao_e_sua'
     and not (v_r->>'ok')::boolean and v_r->>'motivo' = 'lista_nao_e_sua' then
    raise notice '  ✅ 11. pedir contato de uma lista que não é sua é recusado';
  else raise warning '  ❌ 11. deixou puxar lista de outro: % / %', v_f, v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas > 0 then raise exception 'LISTAS: ❌ % falha(s)', v_falhas; end if;
  raise notice 'LISTAS: ✅ as 11 passaram';
end $$;

rollback;
