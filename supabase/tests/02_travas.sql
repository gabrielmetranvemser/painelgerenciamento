-- Travas de servidor.
--
-- AUTOSSUFICIENTE: cria os próprios dados dentro da transação e dá ROLLBACK no
-- final. Pode rodar a qualquer momento, inclusive com a base em produção, sem
-- deixar resíduo e sem depender de fixture externo.
--
-- Cada trava aqui existe porque burlá-la custa dinheiro ou processo: teto e
-- intervalo matam o chip, horário e dia bloqueado são regra eleitoral, e mandar
-- mensagem para quem pediu saída é multa POR MENSAGEM.
--
--   psql -f supabase/tests/02_travas.sql
begin;

-- ── Fixtures (revertidos pelo rollback) ─────────────────────────────────────
do $$
declare i int; v_uid uuid;
begin
  for i in 1..2 loop
    v_uid := gen_random_uuid();
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'trava-' || i || '@painel.local',
      extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    );
    insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em, termo_versao)
    values (v_uid, 'atendente', 'Trava' || i, true, now(), 1);
    insert into public.chips (atendente_id, rotulo, papel, status)
    values (v_uid, 'Chip Trava ' || i, 'ativo', 'ativo');
  end loop;
end $$;

-- ⚠️ `criado_em` no PASSADO, e isso não é detalhe.
--
-- A fila ordena por `criado_em` crescente. Com data futura, estes contatos
-- ficavam ATRÁS de toda a base real, e o `pegar_proximo_contato` do teste 1
-- entregava um contato de verdade — apesar de este arquivo prometer, no
-- cabeçalho, não depender de nada externo.
--
-- Quando o contato sorteado já tinha uma interação de `preparar_mensagem`
-- pendente (texto montado, conversa nunca aberta), o `registrar_abertura` do
-- teste 3 caía no `on conflict` e atualizava AQUELA linha — que aponta para
-- outro chip. O teto do chip do teste continuava zero e as travas 3 e 4
-- falhavam, de forma intermitente, conforme o estado da base real.
--
-- 30 dias atrás põe os seis à frente de qualquer coisa e torna o teste
-- determinístico. Continua tudo revertido pelo rollback.
insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
select 'lista_fria', 'Trava Contato ' || g, 'Trava',
       '55690' || lpad(g::text, 8, '0'),
       '690' || lpad(g::text, 8, '0'),
       'hmac-trava-' || lpad(g::text, 4, '0'),
       'na_fila', now() - make_interval(days => 30, secs => -g)
from generate_series(1, 6) g;

do $$
declare
  v_falhas  int := 0;
  v_uid     uuid;
  v_chip    uuid;
  v_uid2    uuid;
  v_chip2   uuid;
  v_contato uuid;
  v_outro   uuid;
  v_r       jsonb;
  v_cfg_teto int;
  v_cfg_ini  int;
  v_cfg_fim  int;
  v_terceiro uuid;
  v_quarto   uuid;

begin
  select u.id, c.id into v_uid, v_chip
    from public.usuarios u join public.chips c on c.atendente_id = u.id
   where c.rotulo = 'Chip Trava 1';
  select u.id, c.id into v_uid2, v_chip2
    from public.usuarios u join public.chips c on c.atendente_id = u.id
   where c.rotulo = 'Chip Trava 2';

  select teto_diario, hora_inicio, hora_fim
    into v_cfg_teto, v_cfg_ini, v_cfg_fim from public.config where id = 1;

  -- ⚠️ A JANELA DE HORÁRIO ABRE PARA O TESTE INTEIRO, e isso conserta um
  -- defeito do próprio arquivo: como as travas de verdade recusam envio fora do
  -- horário, esta suíte só passava entre 9h e 20h de Porto Velho. Rodar às 21h
  -- devolvia onze falhas que não eram falhas — e a única saída era esperar o
  -- dia seguinte para saber se uma migration tinha quebrado alguma coisa.
  --
  -- Um teste que só roda no horário comercial é um teste que ninguém roda antes
  -- de subir código à noite, que é exatamente quando se sobe código.
  --
  -- A janela real volta no fim, e o rollback desfaz tudo de qualquer jeito.
  update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);

  -- ── 1. claim normal ───────────────────────────────────────────────────────
  v_r := public.pegar_proximo_contato(v_chip);
  v_contato := (v_r->'contato'->>'id')::uuid;
  -- Exige que tenha vindo um contato DESTE arquivo. Sem esta checagem, o dia em
  -- que a fila voltar a entregar um contato real o teste não quebra aqui: ele
  -- quebra três travas adiante, com uma mensagem que não explica nada.
  if (v_r->>'ok')::boolean and v_contato is not null
     and (select nome from public.contatos where id = v_contato) like 'Trava Contato %' then
    raise notice '  ✅ 1. claim entregou um contato (dos criados aqui)';
  else raise warning '  ❌ 1. claim falhou ou veio contato de fora do teste: %', v_r;
    v_falhas := v_falhas + 1;
  end if;

  -- ── 2. anti-fraude: resultado sem conversa aberta ────────────────────────
  v_r := public.registrar_resultado(v_contato, 'autorizou');
  if v_r->>'motivo' = 'conversa_nao_aberta' then
    raise notice '  ✅ 2. resultado recusado sem conversa aberta';
  else raise warning '  ❌ 2. aceitou resultado sem conversa: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. abrir conversa ────────────────────────────────────────────────────
  v_r := public.registrar_abertura(v_contato, v_chip, 'permissao', 'texto de teste');
  if (v_r->>'ok')::boolean and not (v_r->>'ja_registrado')::boolean
     and (v_r->'fila'->>'enviados_hoje')::int = 1 then
    raise notice '  ✅ 3. abertura registrada, teto contou 1';
  else raise warning '  ❌ 3. abertura inesperada: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. idempotência: duplo clique não conta duas vezes ───────────────────
  v_r := public.registrar_abertura(v_contato, v_chip, 'permissao', 'segundo clique');
  if (v_r->>'ja_registrado')::boolean and (v_r->'fila'->>'enviados_hoje')::int = 1 then
    raise notice '  ✅ 4. duplo clique em "Abrir conversa" não inflou o teto';
  else raise warning '  ❌ 4. duplo clique contou de novo: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 4b. o texto enviado fica no log, e o duplo clique não o reescreve ────
  -- É a prova de o que exatamente foi mandado para cada pessoa.
  if (select texto_enviado from public.interacoes
       where contato_id = v_contato and etapa = 'permissao') = 'texto de teste' then
    raise notice '  ✅ 4b. texto enviado preservado no log de auditoria';
  else raise warning '  ❌ 4b. texto perdido ou sobrescrito: %',
       (select texto_enviado from public.interacoes where contato_id = v_contato and etapa = 'permissao');
    v_falhas := v_falhas + 1;
  end if;

  -- ── 4c. preparar_mensagem cria a interação antes; a 1ª abertura de OUTRA
  --        etapa não pode se declarar repetida por causa disso ──────────────
  -- Usa 'quem_passou' porque as etapas de candidato (material e convite) exigem
  -- candidato declarado, e aqui o que se mede é a idempotência, não isso.
  perform public.preparar_mensagem(v_contato, v_chip, 'quem_passou');
  v_r := public.registrar_abertura(v_contato, v_chip, 'quem_passou', 'quem passou 1');
  if not (v_r->>'ja_registrado')::boolean then
    raise notice '  ✅ 4c. primeira abertura não é confundida com repetição';
  else raise warning '  ❌ 4c. primeira abertura veio marcada como repetida: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 5. intervalo mínimo entre conversas ──────────────────────────────────
  v_r := public.fila_status(v_chip);
  if v_r->>'motivo' = 'intervalo' and (v_r->>'segundos_espera')::int > 0 then
    raise notice '  ✅ 5. intervalo travou o botão (% s restantes)', v_r->>'segundos_espera';
  else raise warning '  ❌ 5. intervalo não travou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- envelhece a abertura para destravar o intervalo e testar o teto
  update public.interacoes set aberto_wa_em = now() - interval '300 seconds'
   where contato_id = v_contato;

  -- ── 6. teto diário ───────────────────────────────────────────────────────
  update public.config set teto_diario = 1 where id = 1;
  v_r := public.fila_status(v_chip);
  if v_r->>'motivo' = 'teto_atingido' then
    raise notice '  ✅ 6. teto do dia bloqueou o próximo contato';
  else raise warning '  ❌ 6. teto não bloqueou: %', v_r; v_falhas := v_falhas + 1;
  end if;
  update public.config set teto_diario = v_cfg_teto where id = 1;

  -- ── 7. janela de horário (no fuso de Porto Velho) ────────────────────────
  -- Fecha a janela EM VOLTA da hora atual, seja ela qual for. Os dois ramos
  -- existem porque `hora_fim` tem de ficar entre 1 e 24: à meia-noite não dá
  -- para fechar por baixo, então fecha-se por cima.
  if public.hora_local() >= 1 then
    update public.config set hora_inicio = 0, hora_fim = public.hora_local() where id = 1;
  else
    update public.config set hora_inicio = 1, hora_fim = 24 where id = 1;
  end if;
  v_r := public.fila_status(v_chip);
  if v_r->>'motivo' = 'fora_de_horario' then
    raise notice '  ✅ 7. fora do horário bloqueou (hora local %h)', v_r->>'hora_local';
  else raise warning '  ❌ 7. horário não bloqueou: %', v_r; v_falhas := v_falhas + 1;
  end if;
  update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;

  -- ── 8. dia bloqueado (eleição) ───────────────────────────────────────────
  insert into public.dias_bloqueados (data, motivo) values (public.hoje_operacional(), 'teste');
  v_r := public.fila_status(v_chip);
  if v_r->>'motivo' = 'dia_bloqueado' then
    raise notice '  ✅ 8. dia bloqueado impediu a fila';
  else raise warning '  ❌ 8. dia bloqueado ignorado: %', v_r; v_falhas := v_falhas + 1;
  end if;
  delete from public.dias_bloqueados where data = public.hoje_operacional();

  -- ── 9. chip pausado ──────────────────────────────────────────────────────
  update public.chips set status = 'pausado' where id = v_chip;
  v_r := public.fila_status(v_chip);
  if v_r->>'motivo' = 'chip_indisponivel' then
    raise notice '  ✅ 9. chip pausado não recebe contato';
  else raise warning '  ❌ 9. chip pausado seguiu ativo: %', v_r; v_falhas := v_falhas + 1;
  end if;
  update public.chips set status = 'ativo' where id = v_chip;

  -- ── 10. chip que não é meu ───────────────────────────────────────────────
  v_r := public.fila_status(v_chip2);
  if v_r->>'motivo' = 'chip_nao_e_seu' then
    raise notice '  ✅ 10. não dá para usar o chip de outro atendente';
  else raise warning '  ❌ 10. usou chip alheio: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 11. termo não aceito ─────────────────────────────────────────────────
  update public.usuarios set termo_aceito_em = null where id = v_uid;
  v_r := public.fila_status(v_chip);
  if v_r->>'motivo' = 'termo_nao_aceito' then
    raise notice '  ✅ 11. sem aceite do termo, sem fila';
  else raise warning '  ❌ 11. entrou na fila sem termo: %', v_r; v_falhas := v_falhas + 1;
  end if;
  update public.usuarios set termo_aceito_em = now() where id = v_uid;

  -- ── 12. pedido de saída vira bloqueio no mesmo commit ────────────────────
  v_r := public.registrar_resultado(v_contato, 'pediu_saida');
  if (v_r->>'ok')::boolean
     and exists (select 1 from public.bloqueios b
                  join public.contatos c on c.telefone_hmac = b.telefone_hmac
                 where c.id = v_contato)
     and (select status from public.contatos where id = v_contato) = 'pediu_saida' then
    raise notice '  ✅ 12. "Pediu saída" bloqueou na hora';
  else raise warning '  ❌ 12. saída não bloqueou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 13. bloqueado nunca mais é entregue pela fila ────────────────────────
  select id into v_outro from public.contatos
   where nome like 'Trava Contato %' and status = 'na_fila' limit 1;
  -- Esvazia a fila INTEIRA menos ele. Sem o "menos ele" o teste passaria por
  -- fila vazia em vez de por bloqueio, e sem esvaziar tudo qualquer contato
  -- pré-existente na base faria o teste medir outra coisa. O rollback desfaz.
  update public.contatos set status = 'sem_resposta'
   where status = 'na_fila' and id <> v_outro;
  insert into public.bloqueios (telefone_hmac, motivo, apagar_em)
  select telefone_hmac, 'teste', now() + interval '48 hours'
    from public.contatos where id = v_outro;

  update public.interacoes set aberto_wa_em = now() - interval '600 seconds';
  v_r := public.pegar_proximo_contato(v_chip);
  if v_r->>'motivo' = 'fila_vazia' then
    raise notice '  ✅ 13. contato bloqueado não volta para a fila';
  else raise warning '  ❌ 13. entregou contato bloqueado: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 14. bloqueado não recebe mensagem nem em atendimento aberto ──────────
  update public.contatos set status='em_atendimento', atendente_id=v_uid, chip_id=v_chip,
         claim_expira_em = now() + interval '20 minutes' where id = v_outro;
  v_r := public.registrar_abertura(v_outro, v_chip, 'permissao', 'x');
  if v_r->>'motivo' = 'contato_bloqueado' then
    raise notice '  ✅ 14. abertura recusada para contato bloqueado';
  else raise warning '  ❌ 14. abriu conversa com bloqueado: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- O teto e o intervalo valem no ENVIO, não só na fila
  -- =========================================================================
  -- ⚠️ Estas quatro travas cobrem o buraco maior desta suíte: até aqui, teto e
  -- intervalo eram testados só via `fila_status` / `pegar_proximo_contato` —
  -- isto é, na porta de entrada de contato NOVO. `registrar_abertura`, que é a
  -- função correspondente a uma mensagem saindo de verdade, não checava
  -- nenhum dos dois, e o painel tinha três caminhos que passavam por fora:
  -- a rajada de material da fase de entrega, as mensagens de seguimento pelo
  -- perfil, e o botão "Mandar de novo".

  -- Dois contatos limpos, na mão do atendente. Limpos importa: os contatos das
  -- travas anteriores terminaram bloqueados (teste 12 e 13), e reaproveitar um
  -- deles faria estas travas medirem `contato_bloqueado` em vez de teto.
  --
  --   v_quarto   → já falou hoje: é quem representa a conversa em andamento
  --   v_terceiro → pessoa nova: é quem o teto tem de barrar
  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               claimed_at, claim_expira_em, criado_em)
  values ('lista_fria', 'Trava Envio', 'Trava', '5569930007777', '6930007777',
          'hmac-trava-envio', 'em_atendimento', v_uid, v_chip,
          now(), now() + interval '20 minutes', now() - interval '30 days')
  returning id into v_terceiro;

  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               claimed_at, claim_expira_em, criado_em)
  values ('lista_fria', 'Trava Conversa', 'Trava', '5569930007778', '6930007778',
          'hmac-trava-conversa', 'em_atendimento', v_uid, v_chip,
          now(), now() + interval '20 minutes', now() - interval '30 days')
  returning id into v_quarto;

  -- Zera o histórico do chip e deixa UMA abordagem, velha o bastante para o
  -- intervalo não interferir na trava de teto.
  delete from public.interacoes where chip_id = v_chip;
  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa,
                                 aberto_wa_em, dia_operacional)
  values (v_quarto, v_uid, v_chip, 'permissao',
          now() - interval '600 seconds', public.hoje_operacional());

  -- ── 15. teto do dia recusa a ABERTURA, não só o próximo contato ──────────
  update public.config set teto_diario = 1 where id = 1;
  v_r := public.registrar_abertura(v_terceiro, v_chip, 'permissao', 'x');
  if v_r->>'motivo' = 'teto_atingido' then
    raise notice '  ✅ 15. teto do dia recusa abrir conversa com pessoa nova';
  else raise warning '  ❌ 15. abriu acima do teto: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 16. seguimento na MESMA pessoa não consome teto novo ─────────────────
  -- O teto conta com quantas pessoas o número falou, não quantas mensagens
  -- mandou. Recusar a segunda mensagem de uma conversa já aberta deixaria o
  -- atendente sem responder quem acabou de escrever.
  v_r := public.registrar_abertura(v_quarto, v_chip, 'quem_passou', 'x');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 16. seguir a conversa de quem já contou hoje continua liberado';
  else raise warning '  ❌ 16. seguimento recusado por teto: %', v_r; v_falhas := v_falhas + 1;
  end if;
  update public.config set teto_diario = v_cfg_teto where id = 1;

  -- ── 17. intervalo recusa a ABERTURA de outra abordagem ───────────────────
  update public.interacoes set aberto_wa_em = now() where chip_id = v_chip;
  v_r := public.registrar_abertura(v_terceiro, v_chip, 'permissao', 'x');
  if v_r->>'motivo' = 'intervalo' and (v_r->>'segundos_espera')::int > 0 then
    raise notice '  ✅ 17. intervalo recusa abordagem emendada (% s restantes)',
                 v_r->>'segundos_espera';
  else raise warning '  ❌ 17. abordagem emendada passou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 18. resposta a quem escreveu NÃO espera o intervalo ──────────────────
  -- Decisão de desenho, e deliberada: `saida`, `quem_passou`, `quer_ajudar` e
  -- `encaminhamento` são respostas dentro de uma conversa viva. Fazer o
  -- atendente esperar 90 segundos para responder é o que faz ELE parecer robô —
  -- o oposto do que a trava protege.
  delete from public.interacoes where contato_id = v_quarto and etapa = 'quem_passou';
  v_r := public.registrar_abertura(v_quarto, v_chip, 'quem_passou', 'x');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 18. responder a quem escreveu não espera o intervalo';
  else raise warning '  ❌ 18. resposta travada pelo intervalo: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- O texto nem chega a ser montado quando o envio não pode acontecer
  -- =========================================================================
  -- ⚠️ No painel, `window.open` vinha ANTES do `await` do servidor. Quando a
  -- resposta era "não" — pessoa bloqueada, fora do horário, DIA DA ELEIÇÃO — a
  -- janela do WhatsApp já estava aberta com o texto da campanha preenchido, e a
  -- trava virava um aviso vermelho na aba de trás.
  --
  -- A correção do navegador está em `atendimento.tsx`. Esta é a outra metade:
  -- `preparar_mensagem` recusa cedo, então não existe texto para abrir.

  -- ── 19. dia bloqueado não monta mensagem ─────────────────────────────────
  insert into public.dias_bloqueados (data, motivo) values (public.hoje_operacional(), 'teste');
  v_r := public.preparar_mensagem(v_terceiro, v_chip, 'permissao');
  if v_r->>'motivo' = 'dia_bloqueado' then
    raise notice '  ✅ 19. no dia bloqueado o painel não chega a montar o texto';
  else raise warning '  ❌ 19. montou mensagem em dia bloqueado: %', v_r; v_falhas := v_falhas + 1;
  end if;
  delete from public.dias_bloqueados where data = public.hoje_operacional();

  -- ── 20. fora do horário não monta mensagem ───────────────────────────────
  if public.hora_local() >= 1 then
    update public.config set hora_inicio = 0, hora_fim = public.hora_local() where id = 1;
  else
    update public.config set hora_inicio = 1, hora_fim = 24 where id = 1;
  end if;
  v_r := public.preparar_mensagem(v_terceiro, v_chip, 'permissao');
  if v_r->>'motivo' = 'fora_de_horario' then
    raise notice '  ✅ 20. fora do horário o painel não chega a montar o texto';
  else raise warning '  ❌ 20. montou mensagem fora do horário: %', v_r; v_falhas := v_falhas + 1;
  end if;
  update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;

  -- ── 21. bloqueado não monta mensagem — menos a confirmação de saída ──────
  -- A exceção é a certa: a mensagem de saída não oferece nada, não tem link e
  -- não pede resposta. Ela informa que o pedido foi cumprido, que é justamente
  -- o que a pessoa quer ouvir.
  v_r := public.preparar_mensagem(v_outro, v_chip, 'permissao');
  if v_r->>'motivo' = 'contato_bloqueado' then
    raise notice '  ✅ 21. para quem pediu saída, nem o texto é montado';
  else raise warning '  ❌ 21. montou mensagem para bloqueado: %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.preparar_mensagem(v_outro, v_chip, 'saida');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 21b. a confirmação de saída continua podendo ser montada';
  else raise warning '  ❌ 21b. a saída ficou impossível de mandar: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Devolve a configuração real (o rollback também devolveria).
  update public.config
     set teto_diario = v_cfg_teto, hora_inicio = v_cfg_ini, hora_fim = v_cfg_fim
   where id = 1;

  if v_falhas > 0 then
    raise exception 'RESULTADO: ❌ % trava(s) falharam', v_falhas;
  end if;
  raise notice 'RESULTADO: ✅ todas as travas passaram';
end $$;

rollback;
