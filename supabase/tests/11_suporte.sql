-- Suporte: chamado, thread, anexo e quem enxerga o quê.
--
-- O que se cobre aqui é sobretudo PRIVACIDADE. Um chamado de motivo 'contato'
-- ou 'juridico' carrega o nome e o telefone de um eleitor, e o print anexado
-- carrega a conversa inteira. Chamado alheio visível seria um atendente lendo
-- a conversa dos contatos de outro.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

do $$
declare
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_g      uuid := gen_random_uuid();
  v_chip   uuid;
  v_meu    uuid;
  v_dele   uuid;
  v_ch     uuid;
  v_anexo  uuid;
  v_r      jsonb;
  v_n      int;
  v_falhas int := 0;
begin
  raise notice '── Suporte ──────────────────────────────────────────────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_a, 'sup-a@painel.local'), (v_b, 'sup-b@painel.local'),
                 (v_g, 'sup-g@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_a, 'atendente', 'SupA', true, now()),
         (v_b, 'atendente', 'SupB', true, now()),
         (v_g, 'gestor',    'SupG', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_a, 'Chip Sup', 'ativo', 'ativo') returning id into v_chip;

  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, atendente_id)
  values ('lista_fria', 'Contato Sup', '5569200001001', '6920001001', 'hmac-sup-1001', 'em_atendimento', v_a)
  returning id into v_meu;
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status, atendente_id)
  values ('lista_fria', 'Alheio Sup', '5569200001002', '6920001002', 'hmac-sup-1002', 'em_atendimento', v_b)
  returning id into v_dele;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- ── 1. Abre chamado com contato e chip ───────────────────────────────────
  v_r := public.abrir_chamado('juridico', 'Recebi intimação',
                              'A pessoa mandou print de advogado.', v_meu, v_chip);
  if (v_r->>'ok')::boolean then
    v_ch := (v_r->>'chamado_id')::uuid;
    raise notice '  ✅ 1. atendente abre chamado, com contato e número junto';
  else raise warning '  ❌ 1. não abriu: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. A primeira mensagem entra no mesmo commit ─────────────────────────
  -- Chamado sem texto é um assunto sem caso; os dois nascem juntos.
  if (select count(*) from public.chamado_mensagens where chamado_id = v_ch) = 1 then
    raise notice '  ✅ 2. a primeira mensagem nasce junto com o chamado';
  else raise warning '  ❌ 2. chamado sem mensagem'; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. Não dá para pendurar contato alheio ───────────────────────────────
  -- Sem isso, o campo viraria uma forma de ler o nome de qualquer pessoa da
  -- base a partir de um id.
  v_r := public.abrir_chamado('contato', 'Tentando espiar', 'texto', v_dele, null);
  if v_r->>'motivo' = 'contato_nao_e_seu' then
    raise notice '  ✅ 3. não dá para anexar contato de outro atendente';
  else raise warning '  ❌ 3. anexou contato alheio: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. O colega não enxerga o chamado ────────────────────────────────────
  -- Motivo 'juridico' carrega nome e telefone de eleitor no corpo.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  execute 'set local role authenticated';
  select count(*) into v_n from public.chamados where id = v_ch;
  execute 'reset role';
  if v_n = 0 then
    raise notice '  ✅ 4. atendente não enxerga chamado de colega';
  else raise warning '  ❌ 4. leu chamado alheio'; v_falhas := v_falhas + 1;
  end if;

  -- ── 5. Nem responde nele ─────────────────────────────────────────────────
  v_r := public.responder_chamado(v_ch, 'me intrometendo');
  if v_r->>'motivo' = 'chamado_nao_e_seu' then
    raise notice '  ✅ 5. atendente não responde em chamado de colega';
  else raise warning '  ❌ 5. respondeu em chamado alheio: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Nem marca como resolvido ──────────────────────────────────────────
  v_r := public.mudar_status_chamado(v_ch, 'resolvido');
  if v_r->>'motivo' = 'restrito_ao_gestor' then
    raise notice '  ✅ 6. só o gestor muda o estado do chamado';
  else raise warning '  ❌ 6. atendente mudou o estado: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. Resposta do gestor tira de "aberto" ───────────────────────────────
  -- É o que separa, na lista dele, o que ninguém olhou do que já está andando.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  perform public.responder_chamado(v_ch, 'Pare de usar esse número. Me manda o print.');
  if (select status from public.chamados where id = v_ch) = 'em_analise'
     and (select respondido_em is not null from public.chamados where id = v_ch) then
    raise notice '  ✅ 7. resposta do gestor move o chamado para em análise';
  else raise warning '  ❌ 7. o estado não mudou'; v_falhas := v_falhas + 1;
  end if;

  -- ── 8. Atendente escrevendo em chamado fechado o reabre ──────────────────
  -- Senão a resposta dele fica num lugar que o gestor não olha mais.
  perform public.mudar_status_chamado(v_ch, 'resolvido');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.responder_chamado(v_ch, 'Voltou a acontecer.');
  if (select status from public.chamados where id = v_ch) = 'em_analise'
     and (select resolvido_em is null from public.chamados where id = v_ch) then
    raise notice '  ✅ 8. atendente escrevendo em chamado fechado o reabre';
  else raise warning '  ❌ 8. continuou fechado'; v_falhas := v_falhas + 1;
  end if;

  -- ── 9. Anexo só é registrado no próprio chamado ──────────────────────────
  v_r := public.registrar_anexo(v_ch, v_ch || '/print.webp', 12345, 800, 600);
  if (v_r->>'ok')::boolean then
    v_anexo := (v_r->>'anexo_id')::uuid;
    raise notice '  ✅ 9. o dono registra print no próprio chamado';
  else raise warning '  ❌ 9. não registrou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_r := public.registrar_anexo(v_ch, v_ch || '/intruso.webp', 10, null, null);
  if v_r->>'motivo' = 'chamado_nao_e_seu' then
    raise notice '  ✅ 9b. colega não pendura print em chamado alheio';
  else raise warning '  ❌ 9b. pendurou print alheio: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 10. Print alheio não abre ────────────────────────────────────────────
  -- É a trava que a rota do painel consulta antes de servir o arquivo. O print
  -- é a conversa de um eleitor: vazar aqui é vazar a conversa inteira.
  v_r := public.posso_ver_anexo(v_anexo);
  if not (v_r->>'ok')::boolean then
    raise notice '  ✅ 10. colega não abre o print de chamado alheio';
  else raise warning '  ❌ 10. abriu print alheio'; v_falhas := v_falhas + 1;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_g, 'role', 'authenticated')::text, true);
  v_r := public.posso_ver_anexo(v_anexo);
  if (v_r->>'ok')::boolean and v_r->>'caminho' is not null then
    raise notice '  ✅ 10b. o gestor abre — é para ele que o print foi mandado';
  else raise warning '  ❌ 10b. o gestor não abriu'; v_falhas := v_falhas + 1;
  end if;

  -- ── 11. O balde dos prints é PRIVADO ─────────────────────────────────────
  -- Balde público seria publicar a conversa de alguém numa URL que não expira.
  if exists (
    select 1 from storage.buckets
     where id = 'suporte' and not public and allowed_mime_types = array['image/webp']
  ) then
    raise notice '  ✅ 11. balde `suporte` é privado e só aceita WebP';
  else raise warning '  ❌ 11. balde de prints mal configurado'; v_falhas := v_falhas + 1;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects' and qual like '%suporte%'
  ) then
    raise notice '  ✅ 11b. nenhuma policy dá acesso direto ao balde de prints';
  else raise warning '  ❌ 11b. existe policy de acesso ao balde de prints'; v_falhas := v_falhas + 1;
  end if;

  -- ── 12. O contador de risco jurídico ─────────────────────────────────────
  if (select juridicos_abertos from public.v_resumo) >= 1 then
    raise notice '  ✅ 12. risco jurídico em aberto tem contador próprio no resumo';
  else raise warning '  ❌ 12. o contador não viu o chamado jurídico'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'SUPORTE: ✅ as 12 passaram';
  else raise exception 'SUPORTE: ❌ % falharam', v_falhas;
  end if;
end $$;

rollback;
