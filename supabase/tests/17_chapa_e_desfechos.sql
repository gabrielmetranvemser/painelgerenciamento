-- Chapa obrigatória na permissão, e os desfechos novos.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

-- ⚠️ A janela de horário abre para o teste inteiro (revertida pelo rollback).
update public.config set hora_inicio = 0, hora_fim = 24, intervalo_seg = 0 where id = 1;
delete from public.dias_bloqueados where data = public.hoje_operacional();

do $$
declare
  v_a       uuid := gen_random_uuid();
  v_b       uuid := gen_random_uuid();
  v_gestor  uuid := gen_random_uuid();
  v_chip_a  uuid;
  v_chip_b  uuid;
  v_cand    uuid;
  v_c1      uuid;
  v_c2      uuid;
  v_c3      uuid;
  v_r       jsonb;
  v_f       jsonb;
  v_status  public.status_contato;
  v_adiado  timestamptz;
  v_texto   text;
  v_n       int;
  v_falhas  int := 0;
begin
  raise notice '── Chapa obrigatória e desfechos novos ──────────────────────────────────';

  -- Tira a base REAL de circulação durante a transação (mesmo motivo de
  -- 15_listas: um contato de verdade na frente da fila faria a asserção falhar
  -- por motivo nenhum).
  update public.contatos set adiado_ate = now() + interval '1 day' where status = 'na_fila';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_a, 'chapa-a@painel.local'), (v_b, 'chapa-b@painel.local'),
                 (v_gestor, 'chapa-g@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_a, 'atendente', 'ChapaA', true, now()),
         (v_b, 'atendente', 'ChapaB', true, now()),
         (v_gestor, 'gestor', 'ChapaG', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_a, 'Chip Chapa A', 'ativo', 'ativo') returning id into v_chip_a;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_b, 'Chip Chapa B', 'ativo', 'ativo') returning id into v_chip_b;

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-chapa-cand', 'Cand Chapa', 'deputado_federal', 1, '9971', 'RO', true)
  returning id into v_cand;

  insert into public.listas (origem, rotulo, entregue_por, entregue_em)
  values ('lista_fria', 'Teste Chapa', 'Fulano', current_date);

  insert into public.atendente_listas (atendente_id, lista_id)
  select x.id, (select id from public.listas where rotulo = 'Teste Chapa')
    from (values (v_a), (v_b)) as x(id);

  insert into public.contatos (lista_id, origem, nome, primeiro_nome, telefone_e164,
                               chave_dedup, telefone_hmac, status, criado_em)
  values ((select id from public.listas where rotulo = 'Teste Chapa'),
          'lista_fria', 'Chapa Um', 'Chapa', '5569210000901', '6921000901',
          'hmac-chapa-0901', 'na_fila', now() - interval '3 days')
  returning id into v_c1;

  -- =========================================================================
  -- 1 · Sem chapa, a fila nem começa
  -- =========================================================================
  -- É a trava que faltava em 27/08: quatro atendentes abordaram onze pessoas
  -- antes de ter candidato, e as mensagens saíram sem dizer de quem era o
  -- material.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  v_f := public.fila_status(v_chip_a);
  if v_f->>'motivo' = 'sem_candidato' and not (v_f->>'pode')::boolean then
    raise notice '  ✅ 1. atendente sem chapa recebe sem_candidato';
  else raise warning '  ❌ 1. motivo errado sem chapa: %', v_f; v_falhas := v_falhas + 1;
  end if;

  v_r := public.pegar_proximo_contato(v_chip_a);
  if (v_r->>'motivo') = 'sem_candidato' then
    raise notice '  ✅ 2. e a fila não entrega contato nenhum';
  else raise warning '  ❌ 2. entregou sem chapa: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 2 · Com chapa, tudo volta ao normal
  -- =========================================================================
  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_a, v_cand, 'deputado_federal', 1, true),
         (v_b, v_cand, 'deputado_federal', 1, true);

  v_r := public.pegar_proximo_contato(v_chip_a);
  if (v_r->>'ok')::boolean and (v_r->'contato'->>'id')::uuid = v_c1 then
    raise notice '  ✅ 3. com chapa, a fila entrega normalmente';
  else raise warning '  ❌ 3. não entregou com chapa: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 3 · A permissão em si também é recusada sem chapa
  -- =========================================================================
  -- Não basta a fila recusar: quem já está com um contato na mão (retomada,
  -- contato adicionado à mão) chega em `preparar_mensagem` sem passar pela
  -- fila. É a segunda porta, e a que impede o texto de existir.
  delete from public.atendente_candidatos where atendente_id = v_a;

  v_r := public.preparar_mensagem(v_c1, v_chip_a, 'permissao');
  if v_r->>'motivo' = 'sem_chapa' then
    raise notice '  ✅ 4. preparar_mensagem recusa a permissão sem chapa';
  else raise warning '  ❌ 4. montou a permissão sem chapa: %', v_r; v_falhas := v_falhas + 1;
  end if;

  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_a, v_cand, 'deputado_federal', 1, true);

  v_r := public.preparar_mensagem(v_c1, v_chip_a, 'permissao');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 5. e monta normalmente quando a chapa existe';
  else raise warning '  ❌ 5. não montou com chapa: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 4 · "Falar depois" volta para a fila — e só para quem marcou
  -- =========================================================================
  perform public.registrar_abertura(v_c1, v_chip_a, 'permissao', null,
                                    (v_r->>'variacao_id')::uuid, null);

  -- ⚠️ Recua a abertura uma hora. O intervalo entre abordagens sai da RAMPA do
  -- chip (120s num chip novo), não de `config.intervalo_seg` — então zerar a
  -- config lá em cima não basta, e sem isto os testes 7 e 8 mediriam a trava de
  -- intervalo em vez do reagendamento que eles existem para provar.
  update public.interacoes set aberto_wa_em = now() - interval '1 hour'
   where contato_id = v_c1;

  v_r := public.registrar_resultado(v_c1, 'falar_depois');
  select status, adiado_ate into v_status, v_adiado from public.contatos where id = v_c1;

  if (v_r->>'ok')::boolean and v_status = 'falar_depois'
     and v_adiado > now() + interval '23 hours' then
    raise notice '  ✅ 6. "Falar depois" grava o desfecho e agenda a volta';
  else raise warning '  ❌ 6. adiamento errado: % / %', v_status, v_adiado; v_falhas := v_falhas + 1;
  end if;

  -- Antes da hora, não volta para ninguém.
  v_r := public.pegar_proximo_contato(v_chip_a);
  if (v_r->>'motivo') = 'fila_vazia' then
    raise notice '  ✅ 7. antes da hora, o reagendado não volta';
  else raise warning '  ❌ 7. voltou cedo demais: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- Passada a hora, volta.
  update public.contatos set adiado_ate = now() - interval '1 minute' where id = v_c1;

  v_r := public.pegar_proximo_contato(v_chip_a);
  if (v_r->>'ok')::boolean and (v_r->'contato'->>'id')::uuid = v_c1 then
    raise notice '  ✅ 8. passada a hora, o reagendado volta para quem o marcou';
  else raise warning '  ❌ 8. não voltou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ E NÃO vai para o colega. Um contato reagendado carrega o combinado de
  -- uma conversa que outra pessoa teve; entregá-lo a quem não estava lá faria
  -- a segunda abordagem começar do zero, com a pessoa achando que ninguém
  -- anotou nada.
  update public.contatos
     set status = 'falar_depois', atendente_id = v_a,
         adiado_ate = now() - interval '1 minute', claim_expira_em = null
   where id = v_c1;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);

  v_f := public.fila_status(v_chip_b);
  if (v_f->>'quentes_na_fila')::int + (v_f->>'frios_na_fila')::int = 0 then
    raise notice '  ✅ 9. o reagendado não conta na fila do colega';
  else raise warning '  ❌ 9. contou para o colega: %', v_f; v_falhas := v_falhas + 1;
  end if;

  v_r := public.pegar_proximo_contato(v_chip_b);
  if (v_r->>'ok')::boolean is not true then
    raise notice '  ✅ 10. e não é entregue a ele';
  else raise warning '  ❌ 10. entregue ao colega: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 5 · Os desfechos novos são aceitos, e o texto livre continua fechado
  -- =========================================================================
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);

  update public.contatos set status = 'em_atendimento', adiado_ate = null,
         claim_expira_em = now() + interval '20 minutes'
   where id = v_c1;

  v_r := public.registrar_resultado(v_c1, 'nao_e_a_pessoa');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ 11. desfecho novo é aceito';
  else raise warning '  ❌ 11. recusou desfecho novo: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ⚠️ O texto livre é o ÚNICO campo livre do sistema e o único lugar onde
  -- caberia, por engano, uma anotação de preferência de voto. "Outro" passou a
  -- poder gravar nele; nenhum outro desfecho pode.
  v_r := public.registrar_resultado(v_c1, 'mudou_de_estado', null, 'anotação que não pode existir');
  select encaminhamento into v_texto from public.contatos where id = v_c1;
  if v_texto is null then
    raise notice '  ✅ 12. texto livre não gruda em desfecho que não aceita texto';
  else raise warning '  ❌ 12. gravou texto indevido: %', v_texto; v_falhas := v_falhas + 1;
  end if;

  v_r := public.registrar_resultado(v_c1, 'outro', null, 'ligou pedindo carona para a seção');
  select encaminhamento into v_texto from public.contatos where id = v_c1;
  if v_texto = 'ligou pedindo carona para a seção' then
    raise notice '  ✅ 13. e é gravado quando o desfecho é "Outro"';
  else raise warning '  ❌ 13. não gravou em "Outro": %', v_texto; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · O reparo do consentimento é só do gestor
  -- =========================================================================
  insert into public.contatos (lista_id, origem, nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               primeiro_contato_em, criado_em)
  values ((select id from public.listas where rotulo = 'Teste Chapa'),
          'lista_fria', 'Chapa Orfao', '5569210000902', '6921000902',
          'hmac-chapa-0902', 'autorizou', v_a, v_chip_a, now(), now())
  returning id into v_c2;

  -- Atendente não repara o próprio consentimento: seria destravar o próprio
  -- turno contornando a trava mais séria do sistema.
  v_r := public.declarar_candidatos_pendentes(v_a);
  if v_r->>'motivo' = 'so_gestor' then
    raise notice '  ✅ 14. atendente não repara consentimento';
  else raise warning '  ❌ 14. atendente conseguiu reparar: %', v_r; v_falhas := v_falhas + 1;
  end if;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);

  v_r := public.declarar_candidatos_pendentes(v_a);
  select count(*)::int into v_n
    from public.contato_candidato where contato_id = v_c2 and declarado_em_reparo;

  if (v_r->>'ok')::boolean and (v_r->>'contatos')::int = 1 and v_n = 1 then
    raise notice '  ✅ 15. o gestor repara, e a linha fica marcada como reparo';
  else raise warning '  ❌ 15. reparo errado: % / marcadas %', v_r, v_n; v_falhas := v_falhas + 1;
  end if;

  -- O reparo deixa rastro: contornar o congelamento do consentimento não pode
  -- acontecer em silêncio.
  select count(*)::int into v_n
    from public.alertas where tipo = 'consentimento_reparado' and atendente_id = v_a;
  if v_n = 1 then
    raise notice '  ✅ 16. e o gestor fica com o alerta do que foi feito';
  else raise warning '  ❌ 16. alertas de reparo: %', v_n; v_falhas := v_falhas + 1;
  end if;

  -- Rodar de novo não duplica nem inventa: já não há órfão.
  v_r := public.declarar_candidatos_pendentes(v_a);
  if (v_r->>'contatos')::int = 0 then
    raise notice '  ✅ 17. reparar de novo não faz nada — não há mais órfão';
  else raise warning '  ❌ 17. reparou duas vezes: %', v_r; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'CHAPA E DESFECHOS: ✅ as 17 passaram';
  else raise exception 'CHAPA E DESFECHOS: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
