-- Correções dos achados de severidade média da auditoria.
--
-- AUTOSSUFICIENTE: cria os próprios dados dentro da transação e dá ROLLBACK.
--
--   psql -f supabase/tests/14_medios.sql
begin;

-- A janela de horário abre para o teste inteiro (revertida pelo rollback).
update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;

do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_chip    uuid;
  v_c       uuid;
  v_perdido uuid;
  v_r       jsonb;
  v_texto   text;
  v_falhas  int := 0;
begin
  raise notice '── Correções dos médios ─────────────────────────────────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  ) values (
    '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
    'medio@painel.local', extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
    '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
  );
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'Medina', true, now());
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Medio', 'ativo', 'ativo') returning id into v_chip;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               claimed_at, claim_expira_em, criado_em)
  values ('lista_fria', 'Medio Um', 'Medio', '5569930004444', '6930004444',
          'hmac-medio-4444', 'em_atendimento', v_uid, v_chip,
          now(), now() + interval '20 minutes', now() - interval '30 days')
  returning id into v_c;

  -- =========================================================================
  -- M9 · a prova de auditoria é escrita pelo servidor, não pela tela
  -- =========================================================================
  perform public.preparar_mensagem(v_c, v_chip, 'permissao');
  perform public.gravar_texto_preparado(v_c, 'permissao', null, 'o texto oficial do servidor');

  -- A tela abre a conversa SEM mandar texto — é assim que a ação faz agora.
  v_r := public.registrar_abertura(v_c, v_chip, 'permissao', null);

  select texto_enviado into v_texto from public.interacoes
   where contato_id = v_c and etapa = 'permissao';

  if (v_r->>'ok')::boolean and v_texto = 'o texto oficial do servidor' then
    raise notice '  ✅ M9a. o log guarda o texto que o servidor montou';
  else raise warning '  ❌ M9a. texto no log: %', v_texto; v_falhas := v_falhas + 1;
  end if;

  -- Depois de aberta, o texto é história: nem o próprio servidor reescreve.
  perform public.gravar_texto_preparado(v_c, 'permissao', null, 'tentativa de reescrever');
  select texto_enviado into v_texto from public.interacoes
   where contato_id = v_c and etapa = 'permissao';
  if v_texto = 'o texto oficial do servidor' then
    raise notice '  ✅ M9b. conversa já aberta não tem o texto reescrito';
  else raise warning '  ❌ M9b. texto foi reescrito para: %', v_texto; v_falhas := v_falhas + 1;
  end if;

  -- Contato de outra pessoa não aceita gravação nenhuma.
  perform set_config('request.jwt.claims',
    json_build_object('sub', gen_random_uuid(), 'role', 'authenticated')::text, true);
  v_r := public.gravar_texto_preparado(v_c, 'permissao', null, 'invasor');
  if v_r->>'motivo' = 'contato_nao_e_seu' then
    raise notice '  ✅ M9c. ninguém escreve no log de contato alheio';
  else raise warning '  ❌ M9c. %', v_r; v_falhas := v_falhas + 1;
  end if;
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- M7 · o campo livre só acompanha "Encaminhar"
  -- =========================================================================
  v_r := public.registrar_resultado(v_c, 'quer_ajudar', null, 'anotação que não devia ficar');
  if (v_r->>'ok')::boolean
     and (select encaminhamento is null from public.contatos where id = v_c) then
    raise notice '  ✅ M7a. texto livre não gruda em resultado que não é "Encaminhar"';
  else raise warning '  ❌ M7a. encaminhamento = %',
       (select encaminhamento from public.contatos where id = v_c); v_falhas := v_falhas + 1;
  end if;

  v_r := public.registrar_resultado(v_c, 'encaminhado', null, 'perguntou sobre vaga de emprego');
  if (select encaminhamento = 'perguntou sobre vaga de emprego'
        from public.contatos where id = v_c) then
    raise notice '  ✅ M7b. e continua sendo gravado quando é "Encaminhar"';
  else raise warning '  ❌ M7b. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- M5 · estado que faz sentido, e correção com rastro
  -- =========================================================================
  -- A troca acima (quer_ajudar → encaminhado) já é uma correção de desfecho.
  if exists (select 1 from public.alertas
              where tipo = 'resultado_corrigido' and contato_id = v_c) then
    raise notice '  ✅ M5a. trocar um desfecho já registrado deixa rastro para o gestor';
  else raise warning '  ❌ M5a. correção passou em silêncio'; v_falhas := v_falhas + 1;
  end if;

  -- Contato cujo chip morreu: a conversa foi junto, não há desfecho a marcar.
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac,
                               status, atendente_id, chip_id, primeiro_contato_em, criado_em)
  values ('lista_fria', 'Medio Perdido', '5569930005555', '6930005555', 'hmac-medio-5555',
          'perdido', v_uid, v_chip, now(), now() - interval '30 days')
  returning id into v_perdido;
  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa,
                                 aberto_wa_em, dia_operacional)
  values (v_perdido, v_uid, v_chip, 'permissao', now(), public.hoje_operacional());

  v_r := public.registrar_resultado(v_perdido, 'autorizou');
  if v_r->>'motivo' = 'contato_fora_de_atendimento' then
    raise notice '  ✅ M5b. contato cujo número caiu não recebe desfecho novo';
  else raise warning '  ❌ M5b. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Contato de volta na fila também não: ele pode estar na mão de outra pessoa.
  update public.contatos set status = 'na_fila' where id = v_perdido;
  v_r := public.registrar_resultado(v_perdido, 'autorizou');
  if v_r->>'motivo' = 'contato_fora_de_atendimento' then
    raise notice '  ✅ M5c. contato de volta na fila não tem desfecho decidido por quem saiu';
  else raise warning '  ❌ M5c. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Quem respondeu dias depois continua podendo ser corrigido: 'sem_resposta'
  -- é desfecho de conversa, não saída de cena.
  update public.contatos set status = 'sem_resposta' where id = v_perdido;
  v_r := public.registrar_resultado(v_perdido, 'autorizou');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ M5d. quem respondeu dias depois continua podendo ser corrigido';
  else raise warning '  ❌ M5d. %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas > 0 then raise exception 'MÉDIOS: ❌ % falha(s)', v_falhas; end if;
  raise notice 'MÉDIOS: ✅ tudo passou';
end $$;

rollback;
