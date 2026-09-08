-- Relatório de desempenho por atendente. AUTOSSUFICIENTE: cria os próprios
-- dados e dá ROLLBACK.
--
-- ⚠️ OS TESTES 3, 4 E 7 SÃO OS QUE IMPORTAM.
--
-- O 3 vigia a SOMA DOS GRUPOS. A tela mostra "245 pessoas abordadas" e, logo
-- abaixo, uma barra dividida em quatro. Se os quatro não somarem 245, o gestor
-- não tem como saber qual dos dois números está errado — e vai usar os dois.
--
-- O 4 vigia a CORREÇÃO que motivou tudo isto: contar só a etapa `permissao`
-- dizia que a Gabriela tinha falado com 10 pessoas quando ela tinha falado com
-- 193, e trocava o primeiro lugar do ranking de dono.
--
-- O 7 vigia a PORTA: relatório de desempenho é folha de avaliação de gente, e
-- atendente nenhum abre a do colega.
begin;

update public.config set hora_inicio = 0, hora_fim = 24, intervalo_seg = 0 where id = 1;

do $$
declare
  v_gestor uuid := gen_random_uuid();
  v_a      uuid := gen_random_uuid();
  v_b      uuid := gen_random_uuid();
  v_chip_a uuid;
  v_chip_b uuid;
  v_c1     uuid;
  v_c2     uuid;
  v_c3     uuid;
  v_r      jsonb;
  v_linha  jsonb;
  v_hoje   date := public.hoje_operacional();
  v_falhas int := 0;
begin
  raise notice '── Desempenho por atendente ─────────────────────────────────────────────';

  insert into auth.users (instance_id, id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at, raw_app_meta_data, raw_user_meta_data,
    is_super_admin, confirmation_token, recovery_token, email_change_token_new, email_change)
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_gestor, 'des-g@painel.local'), (v_a, 'des-a@painel.local'),
                 (v_b, 'des-b@painel.local')) as x(id, email);
  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_gestor, 'gestor', 'DesG', true, now()),
         (v_a, 'atendente', 'DesA', true, now()),
         (v_b, 'atendente', 'DesB', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_a, 'Chip Des A', 'ativo', 'ativo') returning id into v_chip_a;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_b, 'Chip Des B', 'ativo', 'ativo') returning id into v_chip_b;

  -- Três contatos do DesA, com desfechos de grupos diferentes.
  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               primeiro_contato_em, criado_em)
  values ('lista_fria', 'Des Um',   'Des', '5569230000801', '6923000801', 'hmac-des-0801',
          'autorizou',    v_a, v_chip_a, now(), now())
  returning id into v_c1;
  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               primeiro_contato_em, criado_em)
  values ('lista_fria', 'Des Dois', 'Des', '5569230000802', '6923000802', 'hmac-des-0802',
          'pediu_saida',  v_a, v_chip_a, now(), now())
  returning id into v_c2;
  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               primeiro_contato_em, criado_em)
  values ('lista_fria', 'Des Três', 'Des', '5569230000803', '6923000803', 'hmac-des-0803',
          'em_atendimento', v_a, v_chip_a, now(), now())
  returning id into v_c3;

  -- =========================================================================
  -- 1 · Só o gestor abre o relatório de desempenho
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  if public.relatorio_de_atendimento(30, null) ? 'erro' then
    raise notice '  ✅ 1. atendente não abre o relatório';
  else raise warning '  ❌ 1. atendente abriu o relatório'; v_falhas := v_falhas + 1;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 2 · Interação SEM "Abrir conversa" não é atendimento
  -- =========================================================================
  -- A interação nasce quando o painel monta o texto. Contá-la como trabalho
  -- transformaria "abri a tela e fechei" em desempenho.
  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa, dia_operacional)
  values (v_c1, v_a, v_chip_a, 'abertura', v_hoje);

  v_r := public.relatorio_de_atendimento(30, null);
  select e into v_linha from jsonb_array_elements(v_r->'equipe') e
   where e->>'atendente_id' = v_a::text;

  if (v_linha->>'pessoas')::int = 0 then
    raise notice '  ✅ 2. tela aberta e fechada não conta como atendimento';
  else raise warning '  ❌ 2. contou conversa que não foi aberta (% pessoas)',
    v_linha->>'pessoas'; v_falhas := v_falhas + 1;
  end if;

  -- Agora sim: três conversas abertas com três pessoas, e uma delas em duas
  -- etapas — o que faz `aberturas` (4) diferir de `pessoas` (3).
  update public.interacoes set aberto_wa_em = now() where contato_id = v_c1;
  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa,
                                 dia_operacional, aberto_wa_em)
  values (v_c1, v_a, v_chip_a, 'permissao', v_hoje, now()),
         (v_c2, v_a, v_chip_a, 'abertura',  v_hoje, now()),
         (v_c3, v_a, v_chip_a, 'abertura',  v_hoje, now());

  v_r := public.relatorio_de_atendimento(30, null);
  select e into v_linha from jsonb_array_elements(v_r->'equipe') e
   where e->>'atendente_id' = v_a::text;

  -- =========================================================================
  -- 3 · Os quatro grupos somam o total de abordados
  -- =========================================================================
  if (v_linha->>'pessoas')::int = 3
     and (v_linha->>'positivos')::int + (v_linha->>'negativos')::int
       + (v_linha->>'sem_resposta')::int + (v_linha->>'em_aberto')::int = 3
     and (v_linha->>'positivos')::int = 1
     and (v_linha->>'negativos')::int = 1
     and (v_linha->>'em_aberto')::int = 1 then
    raise notice '  ✅ 3. os quatro grupos somam exatamente o total de abordados';
  else raise warning '  ❌ 3. os grupos não fecham: %', v_linha; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · "Pessoas" conta qualquer etapa, não só a permissão
  -- =========================================================================
  -- Foi este o defeito da view antiga: dois dos três contatos deste atendente
  -- só têm `abertura`, e a conta antiga os ignorava.
  if (v_linha->>'pessoas')::int = 3 and (v_linha->>'aberturas')::int = 4 then
    raise notice '  ✅ 4. abordagem é a conversa aberta, em qualquer etapa';
  else raise warning '  ❌ 4. pessoas=% aberturas=% (esperado 3 e 4)',
    v_linha->>'pessoas', v_linha->>'aberturas'; v_falhas := v_falhas + 1;
  end if;

  -- E a view de sempre, que alimenta a Visão geral e o CSV, tem de concordar.
  if (select total_abordados from public.v_desempenho_atendente
       where atendente_id = v_a) = 3 then
    raise notice '  ✅ 5. v_desempenho_atendente concorda com o relatório';
  else raise warning '  ❌ 5. a view discorda do relatório'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · O período recorta, e quem não trabalhou fica zerado
  -- =========================================================================
  update public.interacoes set dia_operacional = v_hoje - 40
   where contato_id in (v_c2, v_c3);

  v_r := public.relatorio_de_atendimento(30, null);
  select e into v_linha from jsonb_array_elements(v_r->'equipe') e
   where e->>'atendente_id' = v_a::text;

  if (v_linha->>'pessoas')::int = 1 then
    raise notice '  ✅ 6. o período recorta quem entra na conta';
  else raise warning '  ❌ 6. o período não recortou (% pessoas)',
    v_linha->>'pessoas'; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ `count(distinct (dia, hora))` num left join sem linhas conta `(null,
  -- null)` como um. Quem não trabalhou aparecia com "0 dias" e "1 hora".
  select e into v_linha from jsonb_array_elements(v_r->'equipe') e
   where e->>'atendente_id' = v_b::text;
  if (v_linha->>'dias_trabalhados')::int = 0
     and (v_linha->>'horas_ativas')::int = 0 then
    raise notice '  ✅ 7. quem não trabalhou aparece zerado de verdade';
  else raise warning '  ❌ 7. quem não trabalhou tem hora: %', v_linha;
    v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 8 · O recorte por pessoa muda as séries, e não a lista da equipe
  -- =========================================================================
  -- A lista `equipe` vem inteira sempre: é ela que desenha o seletor e o
  -- ranking, que continuam em pé enquanto o gestor olha uma pessoa.
  v_r := public.relatorio_de_atendimento(0, v_a);
  if jsonb_array_length(v_r->'equipe') >= 2
     and (select count(*) from jsonb_array_elements(v_r->'jornada')) > 0 then
    raise notice '  ✅ 8. escolher uma pessoa recorta as séries, não a equipe';
  else raise warning '  ❌ 8. o recorte por pessoa derrubou a equipe';
    v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 9 · "Tudo" começa no primeiro dia que existe
  -- =========================================================================
  -- Não numa data fixa: o rótulo da tela diz "desde 24/08", e ele tem de ser
  -- verdade, senão o gestor duvida do resto da tela junto.
  if (v_r->'periodo'->>'desde')::date
     = (select min(dia_operacional) from public.interacoes) then
    raise notice '  ✅ 9. "tudo" começa no primeiro dia com atendimento';
  else raise warning '  ❌ 9. "tudo" começa em %', v_r->'periodo'->>'desde';
    v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 10 · A jornada sai em minutos, dentro do dia
  -- =========================================================================
  v_r := public.relatorio_de_atendimento(30, v_a);
  if exists (
    select 1 from jsonb_array_elements(v_r->'jornada') j
     where (j->>'inicio')::int between 0 and 1439
       and (j->>'fim')::int between 0 and 1439
       and (j->>'fim')::int >= (j->>'inicio')::int
  ) then
    raise notice '  ✅ 10. a jornada sai em minutos do dia, e o fim não vem antes do começo';
  else raise warning '  ❌ 10. jornada fora da faixa: %', v_r->'jornada';
    v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'DESEMPENHO POR ATENDENTE: ✅ as 10 passaram';
  else raise exception 'DESEMPENHO POR ATENDENTE: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
