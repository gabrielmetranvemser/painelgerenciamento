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

insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em)
select 'lista_fria', 'Trava Contato ' || g, 'Trava',
       '55690' || lpad(g::text, 8, '0'),
       '690' || lpad(g::text, 8, '0'),
       'hmac-trava-' || lpad(g::text, 4, '0'),
       'na_fila', now() + make_interval(secs => g)
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
  v_cfg_fim  int;

begin
  select u.id, c.id into v_uid, v_chip
    from public.usuarios u join public.chips c on c.atendente_id = u.id
   where c.rotulo = 'Chip Trava 1';
  select u.id, c.id into v_uid2, v_chip2
    from public.usuarios u join public.chips c on c.atendente_id = u.id
   where c.rotulo = 'Chip Trava 2';

  select teto_diario, hora_fim into v_cfg_teto, v_cfg_fim from public.config where id = 1;

  perform set_config('request.jwt.claims', json_build_object('sub', v_uid, 'role','authenticated')::text, true);

  -- ── 1. claim normal ───────────────────────────────────────────────────────
  v_r := public.pegar_proximo_contato(v_chip);
  v_contato := (v_r->'contato'->>'id')::uuid;
  if (v_r->>'ok')::boolean and v_contato is not null then
    raise notice '  ✅ 1. claim entregou um contato';
  else raise warning '  ❌ 1. claim falhou: %', v_r; v_falhas := v_falhas + 1;
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
  update public.config set hora_fim = public.hora_local() where id = 1;
  v_r := public.fila_status(v_chip);
  if v_r->>'motivo' = 'fora_de_horario' then
    raise notice '  ✅ 7. fora do horário bloqueou (hora local %h)', v_r->>'hora_local';
  else raise warning '  ❌ 7. horário não bloqueou: %', v_r; v_falhas := v_falhas + 1;
  end if;
  update public.config set hora_fim = v_cfg_fim where id = 1;

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

  if v_falhas > 0 then
    raise exception 'RESULTADO: ❌ % trava(s) falharam', v_falhas;
  end if;
  raise notice 'RESULTADO: ✅ todas as travas passaram';
end $$;

rollback;
