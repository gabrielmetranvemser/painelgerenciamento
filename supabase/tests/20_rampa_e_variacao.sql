-- A rampa de aquecimento e o congelamento da variação.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ ESTE ARQUIVO EXISTE PORQUE DOIS DEFEITOS PASSARAM DIAS EM PRODUÇÃO SEM
--    NINGUÉM CONSEGUIR NOMEAR O QUE ESTAVA ERRADO — os dois se apresentaram ao
--    gestor como "o painel não está salvando o que eu configuro".
--
-- 1. A RAMPA NÃO OLHAVA O STATUS DO NÚMERO. `rampa_do_chip` aplicava a tabela
--    de aquecimento a todo chip, para sempre, e como o gestor "pode ser mais
--    restritivo, nunca mais permissivo", as 30 conversas que ele configurou
--    viravam `least(8, 30)` = 8 num número marcado como ATIVO havia dias. Ele
--    mexeu no campo três vezes achando que não gravava.
--
-- 2. A VARIAÇÃO GRUDAVA NO CONTATO. `preparar_mensagem` reaproveitava o
--    `variacao_id` já gravado em `interacoes` mesmo quando a mensagem nunca
--    tinha saído e a variação já tinha sido DESATIVADA pelo gestor. Ele
--    reescreveu as mensagens e continuou vendo, na tela do atendente, o texto
--    velho — que era o certo, só que da variação que ele tinha desligado.
--
-- Os dois eram invisíveis para a suíte porque nenhum teste chamava
-- `rampa_do_chip` com status diferente de `aquecendo`, nem preparava a MESMA
-- etapa duas vezes com a variação mudando no meio.
begin;

update public.config
   set hora_inicio = 0, hora_fim = 24, intervalo_seg = 0, teto_diario = 30
 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_uid     uuid := gen_random_uuid();
  v_chip    uuid;
  v_cand    uuid;
  v_lista   uuid;
  v_contato uuid;
  v_modelo  uuid;
  v_v1      uuid;
  v_v2      uuid;
  v_r       jsonb;
  v_rampa   record;
  v_falhas  int := 0;
begin
  raise notice '── Rampa de aquecimento e variação ──────────────────────────────────────';

  -- Tira a base REAL de circulação durante a transação.
  update public.contatos set adiado_ate = now() + interval '1 day' where status = 'na_fila';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  values ('00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
          'rampa-a@painel.local', extensions.crypt('x', extensions.gen_salt('bf')),
          now(), now(), now(), '{"provider":"email","providers":["email"]}', '{}', false,
          '', '', '', '');

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_uid, 'atendente', 'Rampa', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_uid, 'Chip Rampa', 'ativo', 'aquecendo') returning id into v_chip;

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-rampa-cand', 'Cand Rampa', 'deputado_federal', 1, '9992', 'RO', true)
  returning id into v_cand;

  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_uid, v_cand, 'deputado_federal', 1, true);

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Teste Rampa', 'Fulano', current_date) returning id into v_lista;
  insert into public.atendente_listas (atendente_id, lista_id) values (v_uid, v_lista);

  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
                               chave_dedup, telefone_hmac, status, criado_em)
  values (v_lista, 'lista_fria', 'Rampa Antonio', 'Rampa', '5569230000801', '6923000801',
          'hmac-rampa-0801', 'na_fila', now() - interval '3 days')
  returning id into v_contato;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_uid, 'role', 'authenticated')::text, true);

  -- =========================================================================
  -- 1 · A rampa, enquanto o número está aquecendo
  -- =========================================================================
  select * into v_rampa from public.rampa_do_chip(v_chip);

  if v_rampa.em_rampa and v_rampa.teto = 5 and v_rampa.dia_rampa = 1 then
    raise notice '  ✅ 1. chip aquecendo, dia 1: 5 conversas';
  else raise warning '  ❌ 1. rampa do dia 1: %', to_jsonb(v_rampa); v_falhas := v_falhas + 1;
  end if;

  -- O intervalo da rampa é 120s no dia 1, e ele vence o 0 da configuração:
  -- dentro da rampa o gestor só pode APERTAR.
  if v_rampa.intervalo_seg = 120 then
    raise notice '  ✅ 2. e o intervalo da rampa vence o da configuração';
  else raise warning '  ❌ 2. intervalo: %', v_rampa.intervalo_seg; v_falhas := v_falhas + 1;
  end if;

  -- Gestor mais restritivo que a rampa continua valendo.
  update public.config set teto_diario = 3 where id = 1;
  select * into v_rampa from public.rampa_do_chip(v_chip);
  if v_rampa.teto = 3 then
    raise notice '  ✅ 3. dentro da rampa, o gestor ainda pode apertar';
  else raise warning '  ❌ 3. teto: %', v_rampa.teto; v_falhas := v_falhas + 1;
  end if;
  update public.config set teto_diario = 30 where id = 1;

  -- =========================================================================
  -- 2 · Terminado o aquecimento, quem manda é a configuração
  -- =========================================================================
  -- ⚠️ ESTE É O TESTE QUE FALTAVA. Antes da correção, o chip abaixo continuaria
  -- em 5 conversas por dia para sempre — marcado como `ativo`, com o gestor
  -- tendo configurado 30, e sem nada na tela explicando de onde vinha o 5.
  update public.chips set status = 'ativo' where id = v_chip;
  select * into v_rampa from public.rampa_do_chip(v_chip);

  if not v_rampa.em_rampa and v_rampa.teto = 30 then
    raise notice '  ✅ 4. marcado ativo, o número passa a seguir a configuração';
  else raise warning '  ❌ 4. ainda em rampa: %', to_jsonb(v_rampa); v_falhas := v_falhas + 1;
  end if;

  if v_rampa.intervalo_seg = 0 then
    raise notice '  ✅ 5. e o intervalo também sai da configuração';
  else raise warning '  ❌ 5. intervalo: %', v_rampa.intervalo_seg; v_falhas := v_falhas + 1;
  end if;

  -- Mudar o teto na configuração passa a ter efeito de verdade.
  update public.config set teto_diario = 17 where id = 1;
  select * into v_rampa from public.rampa_do_chip(v_chip);
  if v_rampa.teto = 17 then
    raise notice '  ✅ 6. e mudar a configuração muda o limite do atendente';
  else raise warning '  ❌ 6. teto: %', v_rampa.teto; v_falhas := v_falhas + 1;
  end if;
  update public.config set teto_diario = 30 where id = 1;

  -- A tela precisa da ORIGEM do teto, não só do número.
  v_r := public.fila_status(v_chip);
  if (v_r->>'em_rampa')::boolean is false and (v_r->>'teto_gestor')::int = 30 then
    raise notice '  ✅ 7. fila_status conta de onde veio o teto de hoje';
  else raise warning '  ❌ 7. fila_status: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 3 · A variação desativada para de grudar no rascunho
  -- =========================================================================
  select id into v_modelo from public.modelos where etapa = 'permissao' and ativo;

  -- Duas variações nossas, e as de verdade fora do caminho durante o teste.
  update public.variacoes set ativa = false where modelo_id = v_modelo;

  insert into public.variacoes (modelo_id, texto, ordem, ativa)
  values (v_modelo, 'PRIMEIRA: {{candidatos}} e {{origem}}. Me fala que apago seu número.',
          901, true)
  returning id into v_v1;

  insert into public.variacoes (modelo_id, texto, ordem, ativa)
  values (v_modelo, 'SEGUNDA: {{candidatos}} e {{origem}}. Me fala que apago seu número.',
          902, false)
  returning id into v_v2;

  v_r := public.pegar_proximo_contato(v_chip);
  if not (v_r->>'ok')::boolean then
    raise exception 'não consegui pegar o contato para o teste de variação: %', v_r;
  end if;

  -- Rascunho preso na variação DESATIVADA, que é o estado que produção tinha.
  update public.interacoes set variacao_id = v_v2
   where contato_id = v_contato and etapa = 'permissao';
  insert into public.interacoes
    (contato_id, atendente_id, chip_id, etapa, variacao_id, dia_operacional)
  select v_contato, v_uid, v_chip, 'permissao', v_v2, public.hoje_operacional()
   where not exists (select 1 from public.interacoes i
                      where i.contato_id = v_contato and i.etapa = 'permissao');

  v_r := public.preparar_mensagem(v_contato, v_chip, 'permissao');
  if (v_r->>'ok')::boolean and (v_r->>'variacao_id')::uuid = v_v1 then
    raise notice '  ✅ 8. rascunho preso em variação desativada troca pela ativa';
  else raise warning '  ❌ 8. entregou a desativada: %', v_r->>'variacao_id'; v_falhas := v_falhas + 1;
  end if;

  -- E a linha do banco também foi regravada — senão o defeito volta na próxima
  -- chamada, e é a linha que o relatório lê.
  if (select variacao_id from public.interacoes
       where contato_id = v_contato and etapa = 'permissao') = v_v1 then
    raise notice '  ✅ 9. e a linha de interacoes foi regravada junto';
  else raise warning '  ❌ 9. interacoes ficou com a velha'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · Mas o que JÁ SAIU é intocável
  -- =========================================================================
  -- ⚠️ A trava do outro lado, e ela importa mais que a de cima: `interacoes` é
  -- prova de auditoria do que foi enviado. Trocar a variação de uma mensagem
  -- que a pessoa já recebeu falsificaria o histórico.
  v_r := public.registrar_abertura(v_contato, v_chip, 'permissao', 'texto que saiu', v_v1);
  if not (v_r->>'ok')::boolean then
    raise exception 'não consegui registrar a abertura: %', v_r;
  end if;

  update public.variacoes set ativa = false where id = v_v1;
  update public.variacoes set ativa = true  where id = v_v2;

  v_r := public.preparar_mensagem(v_contato, v_chip, 'permissao');
  if (v_r->>'variacao_id')::uuid = v_v1 then
    raise notice '  ✅ 10. mensagem já aberta mantém a variação que saiu de verdade';
  else raise warning '  ❌ 10. reescreveu o histórico: %', v_r->>'variacao_id'; v_falhas := v_falhas + 1;
  end if;

  -- Editar o TEXTO de uma variação sempre chegou na hora; o que estava preso
  -- era a ESCOLHA. Este teste guarda a parte que já funcionava.
  update public.variacoes set texto = 'PRIMEIRA, REESCRITA: {{candidatos}} e {{origem}}.'
   where id = v_v1;
  v_r := public.preparar_mensagem(v_contato, v_chip, 'permissao');
  if v_r->>'modelo' like 'PRIMEIRA, REESCRITA:%' then
    raise notice '  ✅ 11. e o texto reescrito pelo gestor chega na hora seguinte';
  else raise warning '  ❌ 11. texto velho: %', v_r->>'modelo'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'RAMPA E VARIAÇÃO: ✅ as 11 passaram';
  else raise exception 'RAMPA E VARIAÇÃO: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
