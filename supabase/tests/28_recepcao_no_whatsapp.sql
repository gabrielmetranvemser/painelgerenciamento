-- Recepção no WhatsApp: rodízio dos números e reserva do contato.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ OS TESTES 2, 5 E 6 SÃO OS QUE IMPORTAM.
--
-- O 2 vigia o RODÍZIO. O pedido foi "2 números 50/50". Sorteio aleatório não
-- entrega isso — com 10 cadastros, 7/3 é resultado comum, e o gestor concluiria
-- que o sistema está quebrado. Aqui a divisão tem de sair exata.
--
-- O 5 vigia a RESERVA: quem escreveu para o número do A não pode aparecer na
-- fila do B. Se aparecer, a pessoa recebe conversa de dois atendentes da mesma
-- campanha — que é exatamente o que parece spam.
--
-- O 6 vigia o contrário: passado o prazo, o contato TEM de abrir. Reserva sem
-- fim deixaria o lead mais quente do sistema parado porque o dono do número
-- folgou naquele dia.
begin;

update public.config set hora_inicio = 0, hora_fim = 24, intervalo_seg = 0,
       reserva_recepcao_horas = 4 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_gestor uuid := gen_random_uuid();
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_cand   uuid;
  v_ct     uuid;
  v_r      jsonb;
  v_na     int;
  v_nb     int;
  v_falhas int := 0;
begin
  raise notice '── Recepção no WhatsApp ─────────────────────────────────────────────────';

  update public.contatos set adiado_ate = now() + interval '1 day' where status = 'na_fila';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_gestor, 'rec-g@painel.local'), (v_a, 'rec-a@painel.local'),
                 (v_b, 'rec-b@painel.local')) as x(id, email);
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_gestor, 'gestor', 'RecG', true, now()),
         (v_a, 'atendente', 'RecA', true, now()),
         (v_b, 'atendente', 'RecB', true, now());

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-rec-1', 'Cand Rec', 'deputado_federal', 1, '9971', 'RO', true)
  returning id into v_cand;
  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_a, v_cand, 'deputado_federal', 1, true),
         (v_b, v_cand, 'deputado_federal', 1, true);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 1 · Dois números, um de cada atendente
  -- =========================================================================
  perform public.criar_numero_recepcao(v_cand, 'RecA', '5569911110001', v_a, 1);
  perform public.criar_numero_recepcao(v_cand, 'RecB', '5569911110002', v_b, 1);

  if (select count(*) from public.numeros_recepcao where candidato_id = v_cand) = 2 then
    raise notice '  ✅ 1. dois números cadastrados';
  else raise warning '  ❌ 1. não cadastrou'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 2 · ⚠️ O RODÍZIO DIVIDE EXATO — 10 cadastros, 5 e 5
  -- =========================================================================
  for i in 1..10 loop
    perform public.sortear_numero_recepcao(v_cand, null);
  end loop;

  select sorteios into v_na from public.numeros_recepcao where numero_e164 = '5569911110001';
  select sorteios into v_nb from public.numeros_recepcao where numero_e164 = '5569911110002';

  if v_na = 5 and v_nb = 5 then
    raise notice '  ✅ 2. 10 cadastros saíram 5 e 5 — é rodízio, não sorteio cego';
  else raise warning '  ❌ 2. DIVISÃO TORTA: % e % (o gestor pediu 50/50)', v_na, v_nb;
       v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 3 · Peso 2 recebe o dobro
  -- =========================================================================
  -- ⚠️ A conta é a PROPORÇÃO ACUMULADA, e por isso os contadores voltam a zero
  -- aqui. Trocar o peso no meio faz o número que vinha recebendo de menos
  -- recuperar o atraso antes de a divisão estabilizar — comportamento certo, e
  -- que uma expectativa literal de "as próximas 6 saem 4 e 2" acusaria como
  -- defeito. O que precisa valer é o regime, não as primeiras rodadas.
  update public.numeros_recepcao set peso = 2, sorteios = 0
   where numero_e164 = '5569911110001';
  update public.numeros_recepcao set peso = 1, sorteios = 0
   where numero_e164 = '5569911110002';

  for i in 1..30 loop
    perform public.sortear_numero_recepcao(v_cand, null);
  end loop;

  select sorteios into v_na from public.numeros_recepcao where numero_e164 = '5569911110001';
  select sorteios into v_nb from public.numeros_recepcao where numero_e164 = '5569911110002';

  if v_na = 20 and v_nb = 10 then
    raise notice '  ✅ 3. com peso 2 contra 1, 30 cadastros saíram 20 e 10';
  else raise warning '  ❌ 3. o peso não valeu: % e %', v_na, v_nb; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · ⚠️ Número NOVO entra empatado, não zerado
  -- =========================================================================
  v_r := public.criar_numero_recepcao(v_cand, 'RecC', '5569911110003', null, 1);
  if (v_r->>'sorteios')::int = (select max(sorteios) from public.numeros_recepcao
                                 where candidato_id = v_cand and numero_e164 <> '5569911110003') then
    raise notice '  ✅ 4. número novo entra empatado com quem mais recebeu';
  else raise warning '  ❌ 4. ENTROU ZERADO: levaria sozinho os próximos cadastros'; v_falhas := v_falhas + 1;
  end if;

  -- Número desligado não entra no rodízio.
  update public.numeros_recepcao set ativo = false where candidato_id = v_cand;
  if (public.sortear_numero_recepcao(v_cand, null)->>'motivo') = 'sem_numero' then
    raise notice '  ✅ 4b. sem número ativo, não redireciona ninguém';
  else raise warning '  ❌ 4b. sorteou número desligado'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 5 · ⚠️ A RESERVA TIRA O CONTATO DA FILA DOS OUTROS
  -- =========================================================================
  update public.numeros_recepcao set ativo = (numero_e164 = '5569911110001')
   where candidato_id = v_cand;

  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
    chave_dedup, telefone_hmac, status, candidato_origem_id)
  values (null, 'site', 'Rec Um', 'Rec', '5569230000911', '6923000911',
          'hmac-rec-911', 'na_fila', v_cand)
  returning id into v_ct;

  v_r := public.sortear_numero_recepcao(v_cand, v_ct);
  if (v_r->>'ok')::boolean
     and (select reservado_para from public.contatos where id = v_ct) = v_a then
    raise notice '  ✅ 5. o contato ficou reservado para o dono do número';
  else raise warning '  ❌ 5. %', v_r; v_falhas := v_falhas + 1;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  if not exists (
    select 1 from jsonb_array_elements(public.fila_do_atendente(null, null, 50)->'linhas') x
     where (x->>'id')::uuid = v_ct
  ) then
    raise notice '  ✅ 5b. e sumiu da fila do OUTRO atendente';
  else raise warning '  ❌ 5b. DOIS ATENDENTES NA MESMA PESSOA: o contato reservado vazou';
       v_falhas := v_falhas + 1;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  if exists (
    select 1 from jsonb_array_elements(public.fila_do_atendente(null, null, 50)->'linhas') x
     where (x->>'id')::uuid = v_ct
  ) then
    raise notice '  ✅ 5c. mas continua na fila de quem recebeu a mensagem';
  else raise warning '  ❌ 5c. sumiu para o dono do número também'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · ⚠️ VENCIDO O PRAZO, O CONTATO ABRE PARA TODOS
  -- =========================================================================
  update public.contatos set reservado_ate = now() - interval '1 minute' where id = v_ct;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);

  if exists (
    select 1 from jsonb_array_elements(public.fila_do_atendente(null, null, 50)->'linhas') x
     where (x->>'id')::uuid = v_ct
  ) then
    raise notice '  ✅ 6. vencida a reserva, o contato volta para a chapa';
  else raise warning '  ❌ 6. LEAD PRESO: reserva vencida e ninguém mais alcança';
       v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 7 · Reserva zerada na config desliga o mecanismo
  -- =========================================================================
  update public.config set reserva_recepcao_horas = 0 where id = 1;
  update public.contatos set reservado_para = null, reservado_ate = null where id = v_ct;
  perform public.sortear_numero_recepcao(v_cand, v_ct);
  if (select reservado_para from public.contatos where id = v_ct) is null then
    raise notice '  ✅ 7. com a reserva zerada na config, nada é reservado';
  else raise warning '  ❌ 7. reservou mesmo com o prazo em zero'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 8 · Atendente não cadastra número de recepção
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  if (public.criar_numero_recepcao(v_cand, 'Pirata', '5569911110009', null, 1)->>'motivo')
     = 'somente_gestor' then
    raise notice '  ✅ 8. atendente não cadastra número de recepção';
  else raise warning '  ❌ 8. atendente cadastrou número'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'RECEPÇÃO NO WHATSAPP: ✅ as 10 passaram';
  else raise exception 'RECEPÇÃO NO WHATSAPP: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
