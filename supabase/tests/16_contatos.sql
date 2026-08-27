-- A tela de Contatos: filtro, contagem e paginação no servidor.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ Todas as asserções são ANCORADAS nos dados deste arquivo (pela lista de
-- teste ou pelo prefixo "ZZ" no nome). O banco tem a base real, e um teste que
-- esperasse números absolutos passaria só numa máquina vazia.
begin;

do $$
declare
  v_gestor uuid := gen_random_uuid();
  v_at     uuid := gen_random_uuid();
  v_lista  uuid;
  v_r      jsonb;
  v_p0     jsonb;
  v_p1     jsonb;
  v_falhas int := 0;
begin
  raise notice '── Contatos do gestor (filtro, contagem, paginação) ─────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_gestor, 'zz-gestor@painel.local'), (v_at, 'zz-atendente@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_gestor, 'gestor', 'ZZGestor', true, now()),
         (v_at, 'atendente', 'ZZAtendente', true, now());

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'ZZ Lista', 'Fornecedor de Teste', current_date) returning id into v_lista;

  -- 5 na lista: 3 ainda na fila, 2 autorizaram.
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup, telefone_hmac, status)
  select v_lista, 'lista_fria', 'ZZ Contato ' || g,
         '55699' || lpad((7100000 + g)::text, 8, '0'),
         '69' || lpad((7100000 + g)::text, 8, '0'),
         'hmac-zz-' || lpad(g::text, 4, '0'),
         case when g <= 3 then 'na_fila'::public.status_contato else 'autorizou'::public.status_contato end
    from generate_series(1, 5) g;

  -- E um de captação, que não veio de lista nenhuma.
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac, status)
  values ('site', 'ZZ Solto', '5569971990009', '6971990009', 'hmac-zz-solto', 'na_fila');

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);

  -- ── 1. As contagens das abas ─────────────────────────────────────────────
  -- Elas valem DENTRO dos filtros atuais: é o que faz "Autorizaram 2" querer
  -- dizer 2 desta lista, e não 2 da base inteira.
  v_r := public.contatos_do_gestor('todos', null, null, null, null, v_lista);
  if (v_r->'contagens'->>'todos')::int = 5
     and (v_r->'contagens'->>'na_fila')::int = 3
     and (v_r->'contagens'->>'autorizou')::int = 2 then
    raise notice '  ✅ 1. as contagens das abas respeitam o filtro de lista';
  else raise warning '  ❌ 1. contagens erradas: %', v_r->'contagens'; v_falhas := v_falhas + 1;
  end if;

  -- ── 2. O recorte muda a lista, não as contagens ──────────────────────────
  v_r := public.contatos_do_gestor('autorizou', null, null, null, null, v_lista);
  if (v_r->>'total')::int = 2
     and jsonb_array_length(v_r->'linhas') = 2
     and (v_r->'contagens'->>'todos')::int = 5 then
    raise notice '  ✅ 2. o recorte filtra a lista e as abas seguem mostrando o todo';
  else raise warning '  ❌ 2. recorte errado: total=% linhas=%',
    v_r->>'total', jsonb_array_length(v_r->'linhas'); v_falhas := v_falhas + 1;
  end if;

  -- ── 3. Páginas não se repetem nem se pulam ───────────────────────────────
  -- É o defeito clássico de paginação: ordem instável faz a página 2 repetir
  -- gente da página 1, e alguém some da lista sem nunca ter sido visto.
  v_p0 := public.contatos_do_gestor('todos', null, null, null, null, v_lista, false, null, 0, 2);
  v_p1 := public.contatos_do_gestor('todos', null, null, null, null, v_lista, false, null, 1, 2);
  if jsonb_array_length(v_p0->'linhas') = 2
     and jsonb_array_length(v_p1->'linhas') = 2
     and not exists (
       select 1
         from jsonb_array_elements(v_p0->'linhas') a,
              jsonb_array_elements(v_p1->'linhas') b
        where a->>'id' = b->>'id'
     ) then
    raise notice '  ✅ 3. página 1 e página 2 não têm ninguém em comum';
  else raise warning '  ❌ 3. paginação repetiu ou faltou'; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. Página gigante é limitada ─────────────────────────────────────────
  -- O pedido vem da URL. Sem teto, `por_pagina=100000` devolveria a base
  -- inteira pela porta dos fundos — e travaria o navegador do gestor, que é
  -- exatamente o que esta tela passou a evitar.
  v_r := public.contatos_do_gestor('todos', null, null, null, null, null, false, null, 0, 100000);
  if jsonb_array_length(v_r->'linhas') <= 200 then
    raise notice '  ✅ 4. pedido de página gigante é cortado em 200 linhas';
  else raise warning '  ❌ 4. devolveu % linhas', jsonb_array_length(v_r->'linhas'); v_falhas := v_falhas + 1;
  end if;

  -- ── 5. Busca por nome e por telefone ─────────────────────────────────────
  v_r := public.contatos_do_gestor('todos', null, null, null, null, null, false, 'ZZ Contato');
  if (v_r->'contagens'->>'todos')::int = 5 then
    raise notice '  ✅ 5a. busca por nome acha os cinco';
  else raise warning '  ❌ 5a. busca por nome achou %', v_r->'contagens'->>'todos'; v_falhas := v_falhas + 1;
  end if;

  v_r := public.contatos_do_gestor('todos', null, null, null, null, null, false, '(69) 97199-0009');
  if (v_r->'contagens'->>'todos')::int = 1 then
    raise notice '  ✅ 5b. busca por telefone formatado acha pelos dígitos';
  else raise warning '  ❌ 5b. busca por telefone achou %', v_r->'contagens'->>'todos'; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Busca é PARÂMETRO, não pedaço de filtro ───────────────────────────
  -- Montada como texto de filtro do PostgREST, uma vírgula ou um parêntese
  -- digitados na caixa mudariam a expressão inteira. Aqui é só texto.
  v_r := public.contatos_do_gestor('todos', null, null, null, null, null, false, 'ZZ,)(x');
  if (v_r->'contagens'->>'todos')::int = 0 and v_r->>'erro' is null then
    raise notice '  ✅ 6. vírgula e parêntese na busca não quebram nem vazam nada';
  else raise warning '  ❌ 6. busca com pontuação deu %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 7. "Sem lista" é um recorte próprio ──────────────────────────────────
  v_r := public.contatos_do_gestor('todos', null, null, null, null, null, true, 'ZZ');
  if (v_r->'contagens'->>'todos')::int = 1
     and v_r->'linhas'->0->>'nome' = 'ZZ Solto' then
    raise notice '  ✅ 7. o filtro "sem lista" traz só quem se cadastrou sozinho';
  else raise warning '  ❌ 7. filtro sem lista errado: %', v_r->'contagens'; v_falhas := v_falhas + 1;
  end if;

  -- ── 8. Atendente não lê a base do gestor ─────────────────────────────────
  -- A função é `security definer`: ela passa por cima do RLS. Sem a checagem de
  -- papel lá dentro, qualquer autenticado leria nome e telefone de todo mundo.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_at, 'role', 'authenticated')::text, true);

  v_r := public.contatos_do_gestor();
  if v_r->>'erro' = 'somente_gestor' and v_r->'linhas' is null then
    raise notice '  ✅ 8. atendente chamando a função do gestor não recebe linha nenhuma';
  else raise warning '  ❌ 8. vazou para o atendente: %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas > 0 then raise exception 'CONTATOS: ❌ % falha(s)', v_falhas; end if;
  raise notice 'CONTATOS: ✅ as 8 passaram';
end $$;

rollback;
