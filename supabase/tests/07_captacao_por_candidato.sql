-- A página pública de um candidato: dono do lead, escopo do consentimento e
-- a frase de procedência.
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
  v_uid    uuid := gen_random_uuid();
  v_uid2   uuid := gen_random_uuid();
  v_chip   uuid;
  v_cand   uuid;
  v_outro  uuid;
  v_mat    uuid;
  v_canal  uuid;
  v_frio   uuid;
  v_quente uuid;
  v_r      jsonb;
  v_tok    text;
  v_falhas int := 0;
begin
  raise notice '── Captação por candidato ───────────────────────────────────────────────';

  for i in 1..2 loop
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000',
      case i when 1 then v_uid else v_uid2 end,
      'authenticated', 'authenticated', 'capt-' || i || '@painel.local',
      extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    );
    insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
    values (case i when 1 then v_uid else v_uid2 end, 'atendente', 'Capt' || i, true, now());
  end loop;

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Capt', 'ativo', 'ativo') returning id into v_chip;

  insert into public.candidatos (slug, nome_urna, cargo, numero, cnpj_campanha)
  values ('capt-um', 'Capt Um', 'deputado_federal', '7001', '11.111.111/0001-11')
  returning id into v_cand;
  insert into public.candidatos (slug, nome_urna, cargo, numero)
  values ('capt-dois', 'Capt Dois', 'governador', '70')
  returning id into v_outro;

  insert into public.materiais (candidato_id, titulo, url, tipo, ordem)
  values (v_cand, 'Santinho', 'https://exemplo.br/s.pdf', 'santinho', 1) returning id into v_mat;
  insert into public.materiais (candidato_id, titulo, url, tipo, ordem)
  values (v_cand, 'Canal', 'https://whatsapp.com/channel/x', 'canal', 2) returning id into v_canal;

  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_uid, v_cand, 'deputado_federal', 1, true);

  -- Um lead da lista fria e um que se cadastrou na página do candidato.
  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id)
  values ('lista_fria', 'Frio Capt', 'Frio', '5569200000701', '6920000701',
          'hmac-capt-0701', 'em_atendimento', v_uid, v_chip)
  returning id into v_frio;

  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id, candidato_origem_id)
  values ('site', 'Quente Capt', 'Quente', '5569200000702', '6920000702',
          'hmac-capt-0702', 'em_atendimento', v_uid, v_chip, v_cand)
  returning id into v_quente;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- ── 1. A mensagem sabe de onde a pessoa veio ─────────────────────────────
  -- É o que decide a frase de {{origem}}. Sem isto o texto diria "um apoiador
  -- me passou seu contato" para quem preencheu o formulário sozinha.
  v_r := public.preparar_mensagem(v_frio, v_chip, 'permissao');
  if v_r->'contato'->>'origem' = 'lista_fria' then
    raise notice '  ✅ 1. a Permissão do contato frio sai marcada como lista_fria';
  else raise warning '  ❌ 1. origem errada: %', v_r->'contato'->>'origem'; v_falhas := v_falhas + 1;
  end if;

  v_r := public.preparar_mensagem(v_quente, v_chip, 'permissao');
  if v_r->'contato'->>'origem' = 'site' then
    raise notice '  ✅ 1b. e a de quem se cadastrou sozinho, como site';
  else raise warning '  ❌ 1b. origem errada: %', v_r->'contato'->>'origem'; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. O Material manda a PÁGINA do candidato, não a peça solta ──────────
  perform public.registrar_abertura(v_quente, v_chip, 'permissao', 'oi', null);
  v_r := public.preparar_mensagem(v_quente, v_chip, 'material', v_cand);
  if (v_r->>'ok')::boolean and v_r->>'pagina_token' is not null then
    raise notice '  ✅ 2. o Material traz o link da página do candidato';
  else raise warning '  ❌ 2. sem página: %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_tok := v_r->>'pagina_token';

  -- ── 3. A página resolve o token e traz as peças ativas ───────────────────
  v_r := public.pagina_material(v_tok);
  if (v_r->>'ok')::boolean
     and v_r->'candidato'->>'nome_urna' = 'Capt Um'
     and v_r->'candidato'->>'cnpj_campanha' = '11.111.111/0001-11'
     and jsonb_array_length(v_r->'materiais') = 2
     and not (v_r->>'descadastrado')::boolean then
    raise notice '  ✅ 3. a página traz candidato, CNPJ e as duas peças, com link próprio';
  else raise warning '  ❌ 3. página incorreta: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. Peça desativada some da página ────────────────────────────────────
  update public.materiais set ativo = false where id = v_canal;
  v_r := public.pagina_material(v_tok);
  if jsonb_array_length(v_r->'materiais') = 1 then
    raise notice '  ✅ 4. peça desativada pelo gestor some da página na hora';
  else raise warning '  ❌ 4. peça desativada continuou aparecendo'; v_falhas := v_falhas + 1;
  end if;
  update public.materiais set ativo = true where id = v_canal;

  -- ── 5. Quem pediu saída vê a confirmação, não o material de novo ─────────
  insert into public.bloqueios (telefone_hmac, apagar_em)
  values ('hmac-capt-0702', now() + interval '48 hours');
  v_r := public.pagina_material(v_tok);
  if (v_r->>'descadastrado')::boolean then
    raise notice '  ✅ 5. quem já pediu saída vê a confirmação, não o material';
  else raise warning '  ❌ 5. mostrou material a quem pediu saída'; v_falhas := v_falhas + 1;
  end if;
  delete from public.bloqueios where telefone_hmac = 'hmac-capt-0702';

  -- ── 6. O que falta entregar, candidato a candidato ───────────────────────
  v_r := to_jsonb((
    select jsonb_agg(jsonb_build_object(
             'nome', c.nome_urna, 'materiais', c.materiais, 'canais', c.canais,
             'enviado', c.material_enviado_em is not null))
      from public.candidatos_do_contato(v_quente) c
  ));
  if jsonb_array_length(v_r) = 1
     and v_r->0->>'nome' = 'Capt Um'
     and (v_r->0->>'materiais')::int = 2
     and (v_r->0->>'canais')::int = 1 then
    raise notice '  ✅ 6. a tela sabe quantas peças e quantos canais cada candidato tem';
  else raise warning '  ❌ 6. contagem errada: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. Contato de outro atendente é intocável ────────────────────────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid2, 'role', 'authenticated')::text, true);
  if (select count(*) from public.candidatos_do_contato(v_quente)) = 0 then
    raise notice '  ✅ 7. atendente não lê a trilha de propaganda de contato alheio';
  else raise warning '  ❌ 7. leu a trilha de outro atendente'; v_falhas := v_falhas + 1;
  end if;

  -- ── 8. Candidato sem atendente vira lead órfão visível ao gestor ─────────
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac,
                               status, candidato_origem_id)
  values ('site', 'Orfao Capt', '5569200000703', '6920000703', 'hmac-capt-0703',
          'na_fila', v_outro);
  if exists (select 1 from public.v_leads_orfaos where candidato_id = v_outro and na_fila = 1) then
    raise notice '  ✅ 8. lead de candidato sem atendente aparece como órfão';
  else raise warning '  ❌ 8. lead órfão não apareceu'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'CAPTAÇÃO: ✅ as 8 passaram';
  else raise exception 'CAPTAÇÃO: ❌ % falharam', v_falhas;
  end if;
end $$;

rollback;
