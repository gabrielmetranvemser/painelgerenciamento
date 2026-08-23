-- "Buscar outro contato" e o controle de entrega do material impresso.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

do $$
declare
  v_uid    uuid := gen_random_uuid();
  v_gestor uuid := gen_random_uuid();
  v_chip   uuid;
  v_a      uuid;
  v_b      uuid;
  v_cap    uuid;
  v_r      jsonb;
  v_com_adiado int;
  v_sem_adiado int;
  v_falhas int := 0;
begin
  raise notice '── Pular contato e entregas ─────────────────────────────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_uid, 'pular@painel.local'), (v_gestor, 'pular-gestor@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'Pulador', true, now()),
         (v_gestor, 'gestor', 'GestorPular', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Pular', 'ativo', 'ativo') returning id into v_chip;

  -- Dois contatos na fila, o A mais antigo.
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
  values ('lista_fria', 'Pular A', '5569200000801', '6920000801', 'hmac-pular-0801', 'na_fila', now() - interval '2 days')
  returning id into v_a;
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
  values ('lista_fria', 'Pular B', '5569200000802', '6920000802', 'hmac-pular-0802', 'na_fila', now() - interval '1 day')
  returning id into v_b;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- ── 1. A fila devolve o contato que está na mão ──────────────────────────
  -- É o que impede recarregar a página de pular alguém.
  v_r := public.pegar_proximo_contato(v_chip);
  if v_r->'contato'->>'id' = v_a::text then
    v_r := public.pegar_proximo_contato(v_chip);
    if v_r->'contato'->>'id' = v_a::text and (v_r->>'retomada')::boolean then
      raise notice '  ✅ 1. pedir de novo devolve o MESMO contato, sem consumir outro';
    else raise warning '  ❌ 1. não retomou: %', v_r; v_falhas := v_falhas + 1;
    end if;
  else raise warning '  ❌ 1. veio o contato errado: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. Pular solta e entrega o PRÓXIMO, não o mesmo ──────────────────────
  -- Sem o adiamento, o pulado é o mais antigo da fila e volta no clique
  -- seguinte — para a mesma pessoa que acabou de pular.
  v_r := public.pular_contato(v_a, v_chip);
  if (v_r->>'ok')::boolean and v_r->>'destino' = 'devolvido_a_fila' then
    v_r := public.pegar_proximo_contato(v_chip);
    if v_r->'contato'->>'id' = v_b::text then
      raise notice '  ✅ 2. pular devolve à fila e entrega o próximo, não o mesmo';
    else raise warning '  ❌ 2. voltou o pulado: %', v_r; v_falhas := v_falhas + 1;
    end if;
  else raise warning '  ❌ 2. não soltou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. O contador não pode contar quem está adiado ───────────────────────
  -- Contador que promete contato e botão que não entrega é o defeito que a
  -- migration 220200 corrigiu; o adiamento reabriria ele.
  --
  -- A conta é por DIFERENÇA, não por número absoluto: o banco tem a base real
  -- importada, e um teste que espera "zero na fila" passaria só numa máquina
  -- vazia — falharia aqui por motivo nenhum.
  v_com_adiado := (public.fila_status(v_chip)->>'frios_na_fila')::int;
  update public.contatos set adiado_ate = null where id = v_a;
  v_sem_adiado := (public.fila_status(v_chip)->>'frios_na_fila')::int;

  if v_sem_adiado = v_com_adiado + 1 then
    raise notice '  ✅ 3. o contador não conta contato adiado';
  else raise warning '  ❌ 3. contador não mudou ao tirar o adiamento: % → %',
    v_com_adiado, v_sem_adiado; v_falhas := v_falhas + 1;
  end if;
  update public.contatos set adiado_ate = now() + interval '2 hours' where id = v_a;

  -- ── 4. Quem já recebeu mensagem NÃO volta para a fila ────────────────────
  -- Devolver alguém já abordado faria outro atendente abordar de novo.
  perform public.registrar_abertura(v_b, v_chip, 'permissao', 'oi', null);
  v_r := public.pular_contato(v_b, v_chip);
  if (v_r->>'ok')::boolean and v_r->>'destino' = 'aguardando_resposta'
     and (select status from public.contatos where id = v_b) = 'em_atendimento'
     and (select claim_expira_em is null from public.contatos where id = v_b) then
    raise notice '  ✅ 4. quem já foi abordado fica aguardando resposta, não volta à fila';
  else raise warning '  ❌ 4. devolveu quem já foi abordado: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 5. Contato de outro atendente não se pula ────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
  v_r := public.pular_contato(v_b, v_chip);
  if v_r->>'motivo' = 'contato_nao_e_seu' then
    raise notice '  ✅ 5. não dá para soltar contato de outro atendente';
  else raise warning '  ❌ 5. soltou contato alheio: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Entrega: só o gestor marca ────────────────────────────────────────
  insert into public.captacoes (origem, nome, telefone_e164, chave_dedup, itens, endereco)
  values ('kit', 'Kit Teste', '5569200000803', '6920000803',
          array['santinho','camiseta'], 'Rua Teste, 1')
  returning id into v_cap;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  v_r := public.marcar_entrega(v_cap, 'entregue');
  if v_r->>'motivo' = 'restrito_ao_gestor' then
    raise notice '  ✅ 6. atendente não marca entrega — a tabela tem endereço de eleitor';
  else raise warning '  ❌ 6. atendente marcou entrega: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. O gestor marca, e a lista reflete ─────────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
  v_r := public.marcar_entrega(v_cap, 'entregue', 'deixado com a vizinha');
  if (v_r->>'ok')::boolean
     and (select estado from public.v_entregas where id = v_cap) = 'entregue'
     and (select entregue_por from public.captacoes where id = v_cap) = 'GestorPular' then
    raise notice '  ✅ 7. gestor marca entregue, com quem entregou e observação';
  else raise warning '  ❌ 7. não marcou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 8. Cancelado não é entregue ──────────────────────────────────────────
  -- Endereço errado virando "entregue" mentiria no relatório da campanha.
  v_r := public.marcar_entrega(v_cap, 'cancelado', 'endereço não existe');
  if (select estado from public.v_entregas where id = v_cap) = 'cancelado'
     and (select entregue_em is null from public.captacoes where id = v_cap) then
    raise notice '  ✅ 8. cancelar limpa a entrega — não vira entrega falsa no relatório';
  else raise warning '  ❌ 8. cancelamento não limpou a entrega'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'PULAR E ENTREGAS: ✅ as 8 passaram';
  else raise exception 'PULAR E ENTREGAS: ❌ % falharam', v_falhas;
  end if;
end $$;

rollback;
