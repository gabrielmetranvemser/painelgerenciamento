-- Itens de kit, mensagens do gestor, comitês, correção de contato e consulta
-- de telefone. AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_a       uuid := gen_random_uuid();
  v_b       uuid := gen_random_uuid();
  v_chip_a  uuid;
  v_chip_b  uuid;
  v_cand    uuid;
  v_c1      uuid;
  v_c2      uuid;
  v_m1      uuid;
  v_m2      uuid;
  v_r       jsonb;
  v_texto   text;
  v_n       int;
  v_falhas  int := 0;
begin
  raise notice '── Cadastros do gestor ──────────────────────────────────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_a, 'cad-a@painel.local'), (v_b, 'cad-b@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_a, 'atendente', 'CadA', true, now()),
         (v_b, 'atendente', 'CadB', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_a, 'Chip Cad A', 'ativo', 'ativo') returning id into v_chip_a;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_b, 'Chip Cad B', 'ativo', 'ativo') returning id into v_chip_b;

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-cad-cand', 'Cand Cad', 'deputado_federal', 1, '9981', 'RO', true)
  returning id into v_cand;

  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_a, v_cand, 'deputado_federal', 1, true),
         (v_b, v_cand, 'deputado_federal', 1, true);

  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               claimed_at, claim_expira_em, criado_em)
  values ('lista_fria', 'Cad Um', 'Cad', '5569220000901', '6922000901',
          'hmac-cad-0901', 'em_atendimento', v_a, v_chip_a,
          now(), now() + interval '20 minutes', now())
  returning id into v_c1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 1 · Itens de kit
  -- =========================================================================
  -- ⚠️ O item é CRIADO AQUI, e o teste não conta quantos existem na base.
  --
  -- A primeira versão afirmava "os três de sempre continuam ativos" — e quebrou
  -- no dia em que o gestor desativou a camiseta pela tela nova, que é
  -- exatamente o que a tela existe para fazer. Teste que depende do que o
  -- gestor faz em produção acusa falha onde houve uso normal.
  insert into public.itens_kit (chave, rotulo, pede_tamanho, ordem, ativo)
  values ('teste_bone', 'Boné de teste', true, 900, true);

  select count(*)::int into v_n
    from public.itens_kit_ativos() where chave = 'teste_bone';
  if v_n = 1 then
    raise notice '  ✅ 1. item novo aparece nas telas';
  else raise warning '  ❌ 1. item novo não apareceu'; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ A chave é para SEMPRE: fica gravada em `captacoes.itens` de quem pediu.
  -- Item sai de circulação sendo DESATIVADO, e o histórico continua legível.
  update public.itens_kit set ativo = false where chave = 'teste_bone';
  select count(*)::int into v_n
    from public.itens_kit_ativos() where chave = 'teste_bone';
  if v_n = 0 then
    raise notice '  ✅ 2. item desativado some das telas novas';
  else raise warning '  ❌ 2. item desativado continuou aparecendo'; v_falhas := v_falhas + 1;
  end if;

  select count(*)::int into v_n from public.itens_kit where chave = 'teste_bone';
  if v_n = 1 then
    raise notice '  ✅ 3. mas a linha continua lá, para o relatório antigo';
  else raise warning '  ❌ 3. a linha sumiu'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 2 · Mensagens do gestor
  -- =========================================================================
  insert into public.modelos_livres (nome, dica, texto, e_abordagem, ordem)
  values ('Carreata', 'quando perguntam da agenda',
          'Oi, {{primeiro_nome}}! Tem carreata sábado às 9h. Se quiser parar de receber, me avisa.',
          false, 1)
  returning id into v_m1;

  insert into public.modelos_livres (nome, texto, e_abordagem, ordem)
  values ('Material atrasado', 'Oi, {{primeiro_nome}}! O material atrasou, chega terça.', true, 2)
  returning id into v_m2;

  -- ⚠️ A tabela dos sete fixos não pode receber uma oitava etapa.
  begin
    insert into public.modelos (etapa, nome, ativo) values ('livre', 'Errado', true);
    raise warning '  ❌ 4. deixou criar etapa fixa "livre"'; v_falhas := v_falhas + 1;
  exception when check_violation then
    raise notice '  ✅ 4. a tabela das sete etapas recusa uma oitava';
  end;

  v_r := public.preparar_mensagem(v_c1, v_chip_a, 'livre', null, v_m1);
  if (v_r->>'ok')::boolean and (v_r->>'modelo') like 'Oi, {{primeiro_nome}}%' then
    raise notice '  ✅ 5. mensagem do gestor é montada';
  else raise warning '  ❌ 5. não montou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.preparar_mensagem(v_c1, v_chip_a, 'livre', null, null);
  if v_r->>'motivo' = 'modelo_obrigatorio' then
    raise notice '  ✅ 6. "livre" sem modelo é recusada';
  else raise warning '  ❌ 6. montou sem modelo: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ O TESTE QUE IMPORTA. Todos os livres compartilham a etapa `livre`; se o
  -- índice único não conhecesse `modelo_livre_id`, a segunda mensagem colidiria
  -- com a primeira e o `do update` apagaria o registro dela — prova de
  -- auditoria perdida em silêncio.
  perform public.registrar_abertura(v_c1, v_chip_a, 'livre', null, null, null, v_m1);
  update public.interacoes set aberto_wa_em = now() - interval '1 hour'
   where contato_id = v_c1;
  perform public.preparar_mensagem(v_c1, v_chip_a, 'livre', null, v_m2);
  perform public.registrar_abertura(v_c1, v_chip_a, 'livre', null, null, null, v_m2);

  select count(*)::int into v_n
    from public.interacoes
   where contato_id = v_c1 and etapa = 'livre' and aberto_wa_em is not null;

  if v_n = 2 then
    raise notice '  ✅ 7. duas mensagens do gestor são DUAS interações';
  else raise warning '  ❌ 7. interações livres: % (esperava 2)', v_n; v_falhas := v_falhas + 1;
  end if;

  -- E a mesma, duas vezes, continua sendo UMA: o duplo clique segue idempotente.
  perform public.registrar_abertura(v_c1, v_chip_a, 'livre', null, null, null, v_m1);
  select count(*)::int into v_n
    from public.interacoes where contato_id = v_c1 and modelo_livre_id = v_m1;
  if v_n = 1 then
    raise notice '  ✅ 8. a mesma mensagem duas vezes continua sendo uma';
  else raise warning '  ❌ 8. duplicou: %', v_n; v_falhas := v_falhas + 1;
  end if;

  -- O texto de cada uma é o dela: `gravar_texto_preparado` precisa do modelo.
  perform public.gravar_texto_preparado(v_c1, 'livre', null, 'texto da segunda', v_m2);
  select texto_enviado into v_texto
    from public.interacoes where contato_id = v_c1 and modelo_livre_id = v_m1;
  if v_texto is distinct from 'texto da segunda' then
    raise notice '  ✅ 9. o texto de uma não sobrescreve o da outra';
  else raise warning '  ❌ 9. o texto vazou entre mensagens'; v_falhas := v_falhas + 1;
  end if;

  -- `e_abordagem` decide se conta o intervalo, e nas mensagens do gestor quem
  -- decide é ele — a mensagem dele tanto pode abrir uma conversa quanto
  -- responder uma que já existe.
  --
  -- ⚠️ Nas etapas FIXAS, desde `conversa_em_quatro_passos`, abordagem é só a
  -- `abertura`. A permissão virou o terceiro passo de uma conversa que a pessoa
  -- já respondeu duas vezes; esperar o intervalo ali faria o atendente sumir no
  -- meio do próprio diálogo.
  if public.interacao_de_abordagem('livre', v_m1) = false
     and public.interacao_de_abordagem('livre', v_m2) = true
     and public.interacao_de_abordagem('abertura', null) = true
     and public.interacao_de_abordagem('permissao', null) = false
     and public.interacao_de_abordagem('saida', null) = false then
    raise notice '  ✅ 10. o intervalo pergunta ao modelo, e nas fixas só a abertura conta';
  else raise warning '  ❌ 10. abordagem errada'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 3 · Comitês
  -- =========================================================================
  insert into public.comites (candidato_id, nome, municipio_id, latitude, longitude)
  values (v_cand, 'Comitê Central', 1, -8.76077, -63.8999);

  select count(*)::int into v_n from public.comites_do_candidato(v_cand);
  if v_n = 1 then
    raise notice '  ✅ 11. o comitê aparece para o candidato dele';
  else raise warning '  ❌ 11. comitês do candidato: %', v_n; v_falhas := v_falhas + 1;
  end if;

  -- Meia coordenada não é coordenada.
  begin
    insert into public.comites (candidato_id, nome, latitude) values (v_cand, 'Torto', -8.7);
    raise warning '  ❌ 12. aceitou meia coordenada'; v_falhas := v_falhas + 1;
  exception when check_violation then
    raise notice '  ✅ 12. meia coordenada é recusada';
  end;

  -- ⚠️ O comitê só alcança quem foi DECLARADO àquele candidato — a mesma lista
  -- congelada do consentimento. Sem contato_candidato, nada aparece.
  select count(*)::int into v_n from public.comites_do_contato(v_c1);
  if v_n = 0 then
    raise notice '  ✅ 13. sem candidato declarado, o contato não vê comitê';
  else raise warning '  ❌ 13. viu comitê sem consentimento: %', v_n; v_falhas := v_falhas + 1;
  end if;

  insert into public.contato_candidato (contato_id, candidato_id, atendente_id)
  values (v_c1, v_cand, v_a);

  select count(*)::int into v_n from public.comites_do_contato(v_c1);
  if v_n = 1 then
    raise notice '  ✅ 14. declarado o candidato, o comitê dele aparece';
  else raise warning '  ❌ 14. comitês do contato: %', v_n; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · Consulta de telefone antes de cadastrar
  -- =========================================================================
  v_r := public.consultar_telefone('hmac-cad-0901');
  if (v_r->>'ok')::boolean and (v_r->>'existe')::boolean and (v_r->>'meu')::boolean then
    raise notice '  ✅ 15. o próprio contato é reconhecido como meu';
  else raise warning '  ❌ 15. consulta errada: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- O colega vê que é de outra pessoa, e QUEM — mas nada além disso.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);

  v_r := public.consultar_telefone('hmac-cad-0901');
  if (v_r->>'existe')::boolean and (v_r->>'meu')::boolean is false
     and v_r->>'atendente' = 'CadA'
     and v_r->'nome' is null and v_r->'telefone_e164' is null then
    raise notice '  ✅ 16. o colega vê de quem é, e só isso';
  else raise warning '  ❌ 16. vazou ou faltou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.consultar_telefone('hmac-que-nao-existe');
  if (v_r->>'existe')::boolean is false then
    raise notice '  ✅ 17. número que não está na base responde "não existe"';
  else raise warning '  ❌ 17. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Bloqueado é a resposta que muda o que a pessoa pode fazer.
  insert into public.bloqueios (telefone_hmac, hmac_versao, motivo, origem, apagar_em)
  values ('hmac-cad-bloq', 1, 'teste', 'pediu_saida', now() + interval '48 hours');

  v_r := public.consultar_telefone('hmac-cad-bloq');
  if (v_r->>'bloqueado')::boolean then
    raise notice '  ✅ 18. número bloqueado é avisado como bloqueado';
  else raise warning '  ❌ 18. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 5 · Correção de nome e telefone
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  v_r := public.corrigir_contato(v_a, v_c1, 'Cad Um Corrigido', 'Cad');
  select nome into v_texto from public.contatos where id = v_c1;
  if (v_r->>'ok')::boolean and v_texto = 'Cad Um Corrigido' then
    raise notice '  ✅ 19. o nome é corrigido';
  else raise warning '  ❌ 19. nome: % / %', v_r, v_texto; v_falhas := v_falhas + 1;
  end if;

  select count(*)::int into v_n
    from public.contato_correcoes where contato_id = v_c1 and campo = 'nome';
  if v_n = 1 then
    raise notice '  ✅ 20. e a correção deixa rastro';
  else raise warning '  ❌ 20. rastros: %', v_n; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ Trocar o número para um BLOQUEADO seria trazer de volta, por uma porta
  -- lateral, quem pediu para sair — multa por mensagem.
  v_r := public.corrigir_contato(v_a, v_c1, null, null, '5569220000999', '6922000999',
                                 'hmac-cad-bloq', 1);
  if v_r->>'motivo' = 'numero_bloqueado' then
    raise notice '  ✅ 21. não dá para apontar a ficha para um número bloqueado';
  else raise warning '  ❌ 21. deixou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Nem para um número que já é de outra ficha.
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac,
                               status, atendente_id, criado_em)
  values ('lista_fria', 'Cad Dois', '5569220000902', '6922000902', 'hmac-cad-0902',
          'na_fila', null, now())
  returning id into v_c2;

  v_r := public.corrigir_contato(v_a, v_c1, null, null, '5569220000902', '6922000902',
                                 'hmac-cad-0902', 1);
  if v_r->>'motivo' = 'numero_ja_existe' then
    raise notice '  ✅ 22. nem para um número que já é de outra ficha';
  else raise warning '  ❌ 22. deixou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- E ninguém corrige a ficha de contato alheio.
  v_r := public.corrigir_contato(v_b, v_c1, 'Invasor', 'Invasor');
  if v_r->>'motivo' = 'contato_nao_e_seu' then
    raise notice '  ✅ 23. ninguém corrige a ficha de contato alheio';
  else raise warning '  ❌ 23. deixou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'CADASTROS DO GESTOR: ✅ as 23 passaram';
  else raise exception 'CADASTROS DO GESTOR: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
