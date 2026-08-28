-- Correções dos achados de severidade alta da auditoria.
--
-- AUTOSSUFICIENTE: cria os próprios dados dentro da transação e dá ROLLBACK.
--
--   psql -f supabase/tests/13_altos.sql
begin;

-- A janela de horário abre para o teste inteiro (revertida pelo rollback): as
-- travas de verdade recusam envio fora do horário, e um teste que só roda no
-- horário comercial é um teste que ninguém roda antes de subir código à noite.
update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;

do $$
declare
  v_a       uuid := gen_random_uuid();
  v_b       uuid := gen_random_uuid();
  v_chip_a  uuid;
  v_chip_b  uuid;
  v_contato uuid;
  v_cand    uuid;
  v_r       jsonb;
  v_int     public.interacoes%rowtype;
  v_alerta  bigint;
  v_falhas  int := 0;
begin
  raise notice '── Correções dos altos ──────────────────────────────────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_a, 'alto-a@painel.local'), (v_b, 'alto-b@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_a, 'atendente', 'Alice', true, now()),
         (v_b, 'atendente', 'Bruno', true, now());

  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_a, 'Chip Alice', 'ativo', 'ativo') returning id into v_chip_a;
  insert into public.chips (atendente_id, rotulo, papel, status)
  values (v_b, 'Chip Bruno', 'ativo', 'ativo') returning id into v_chip_b;

  -- Chapa. Desde `chapa_obrigatoria_na_permissao`, atendente sem candidato
  -- recebe `sem_candidato` e a fila não entrega nada — sem estas linhas este
  -- arquivo mediria a configuração do atendente em vez do que existe para
  -- provar. Mesmo motivo das listas em 01_fixtures.
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-altos-cand', 'Cand Altos', 'deputado_federal', 1, '9961', 'RO', true)
  returning id into v_cand;

  insert into public.atendente_candidatos (atendente_id, candidato_id, cargo, vaga, principal)
  values (v_a, v_cand, 'deputado_federal', 1, true),
         (v_b, v_cand, 'deputado_federal', 1, true);

  -- =========================================================================
  -- A1 · a conversa é de quem ABRE, não de quem preparou
  -- =========================================================================
  insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
                               telefone_hmac, status, atendente_id, chip_id,
                               claimed_at, claim_expira_em, criado_em)
  values ('lista_fria', 'Passa de Mao', 'Passa', '5569930001111', '6930001111',
          'hmac-alto-1111', 'em_atendimento', v_a, v_chip_a,
          now(), now() + interval '20 minutes', now() - interval '30 days')
  returning id into v_contato;

  -- Alice prepara o texto e não fala com ninguém.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
  perform public.preparar_mensagem(v_contato, v_chip_a, 'permissao');

  -- O rascunho nasce com o nome dela — é o que fixa a variação.
  select * into v_int from public.interacoes
   where contato_id = v_contato and etapa = 'permissao';
  if v_int.atendente_id = v_a and v_int.aberto_wa_em is null then
    raise notice '  ✅ A1a. o rascunho nasce com quem preparou';
  else raise warning '  ❌ A1a. rascunho inesperado: %', to_jsonb(v_int); v_falhas := v_falhas + 1;
  end if;

  -- Alice solta o contato. Bruno pega e é quem fala.
  perform public.pular_contato(v_contato, v_chip_a);
  update public.contatos
     set status = 'em_atendimento', atendente_id = v_b, chip_id = v_chip_b,
         claimed_at = now(), claim_expira_em = now() + interval '20 minutes',
         adiado_ate = null
   where id = v_contato;

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  v_r := public.registrar_abertura(v_contato, v_chip_b, 'permissao', 'quem falou foi o Bruno');

  select * into v_int from public.interacoes
   where contato_id = v_contato and etapa = 'permissao';

  if (v_r->>'ok')::boolean and v_int.atendente_id = v_b and v_int.chip_id = v_chip_b then
    raise notice '  ✅ A1b. quem abriu virou o dono da interação, com o chip dele';
  else raise warning '  ❌ A1b. interação ficou com quem só preparou: %', to_jsonb(v_int);
    v_falhas := v_falhas + 1;
  end if;

  -- E o teto que subiu foi o de Bruno, não o de Alice.
  --
  -- A conta de Alice é consultada COM A SESSÃO DELA: desde a migration 330500,
  -- `fila_status` recusa chip alheio antes de calcular qualquer número — se
  -- fosse perguntado como Bruno, viria zero por recusa, e o teste passaria pelo
  -- motivo errado.
  if (v_r->'fila'->>'enviados_hoje')::int <> 1 then
    raise warning '  ❌ A1c. o envio não contou no teto de quem falou: %', v_r->'fila';
    v_falhas := v_falhas + 1;
  else
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_a, 'role', 'authenticated')::text, true);
    if (public.fila_status(v_chip_a)->>'enviados_hoje')::int = 0 then
      raise notice '  ✅ A1c. o envio contou no teto de quem falou, e só nele';
    else raise warning '  ❌ A1c. o teto de quem só preparou também subiu: %',
         public.fila_status(v_chip_a); v_falhas := v_falhas + 1;
    end if;
    perform set_config('request.jwt.claims',
      json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  end if;

  -- Depois de aberta, a linha é imutável: duplo clique não muda de dono.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_b, 'role', 'authenticated')::text, true);
  perform public.registrar_abertura(v_contato, v_chip_b, 'permissao', 'segundo clique');
  select * into v_int from public.interacoes
   where contato_id = v_contato and etapa = 'permissao';
  if v_int.texto_enviado = 'quem falou foi o Bruno' then
    raise notice '  ✅ A1d. depois de aberta, a interação não se reescreve';
  else raise warning '  ❌ A1d. texto sobrescrito: %', v_int.texto_enviado; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- A2 · desfazer um "Pediu saída" passou a ser do gestor
  -- =========================================================================
  v_r := public.registrar_resultado(v_contato, 'pediu_saida');
  if (v_r->>'ok')::boolean then
    raise notice '  ✅ A2a. marcar "Pediu saída" continua funcionando';
  else raise warning '  ❌ A2a. %', v_r; v_falhas := v_falhas + 1;
  end if;

  v_r := public.registrar_resultado(v_contato, 'autorizou');
  if v_r->>'motivo' = 'saida_so_o_gestor_desfaz'
     and exists (select 1 from public.bloqueios b
                  join public.contatos c on c.telefone_hmac = b.telefone_hmac
                 where c.id = v_contato)
  then
    raise notice '  ✅ A2b. o atendente não desfaz sozinho, e o bloqueio fica de pé';
  else raise warning '  ❌ A2b. o atendente desfez o bloqueio: %', v_r; v_falhas := v_falhas + 1;
  end if;

  select id into v_alerta from public.alertas
   where tipo = 'saida_para_revisar' and contato_id = v_contato and resolvido_em is null;

  if v_alerta is not null then
    raise notice '  ✅ A2c. o pedido de revisão chegou ao gestor, com o contato em anexo';
  else raise warning '  ❌ A2c. nenhum alerta para o gestor agir'; v_falhas := v_falhas + 1;
  end if;

  -- Clicar de novo não enche a lista do gestor de avisos iguais.
  perform public.registrar_resultado(v_contato, 'autorizou');
  if (select count(*) from public.alertas
       where tipo = 'saida_para_revisar' and contato_id = v_contato and resolvido_em is null) = 1 then
    raise notice '  ✅ A2d. insistir não gera um alerta por clique';
  else raise warning '  ❌ A2d. alertas duplicados'; v_falhas := v_falhas + 1;
  end if;

  -- Saída pedida pela própria pessoa, pelo link, continua sem volta nenhuma.
  update public.bloqueios set origem = 'landing'
   where telefone_hmac = (select telefone_hmac from public.contatos where id = v_contato);
  v_r := public.registrar_resultado(v_contato, 'autorizou');
  if v_r->>'motivo' = 'saida_pedida_pela_pessoa' then
    raise notice '  ✅ A2e. descadastro feito pela pessoa não se desfaz por aqui';
  else raise warning '  ❌ A2e. %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- A3 · fuso horário inválido não entra
  -- =========================================================================
  begin
    update public.config set timezone = 'America/PortoVelho' where id = 1;
    raise warning '  ❌ A3. o banco aceitou um fuso que não existe'; v_falhas := v_falhas + 1;
  exception when check_violation then
    raise notice '  ✅ A3. fuso inexistente é recusado pelo banco';
  end;

  -- =========================================================================
  -- A8 · o termômetro do chip conta o silêncio já fechado pelo cron
  -- =========================================================================
  -- Dez abordagens antigas, todas sem resposta: cinco ainda 'em_atendimento' e
  -- cinco já fechadas em 'sem_resposta' pelo cron das 72h. Antes, só as cinco
  -- primeiras contavam e o farol subia sozinho para verde.
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac,
                               status, atendente_id, chip_id, primeiro_contato_em, criado_em)
  select 'lista_fria', 'Mudo ' || g,
         '55699300022' || lpad(g::text, 2, '0'),
         '69300022' || lpad(g::text, 2, '0'),
         'hmac-alto-mudo-' || g,
         case when g <= 5 then 'em_atendimento' else 'sem_resposta' end::public.status_contato,
         v_a, v_chip_a, now() - interval '4 days', now() - interval '30 days'
    from generate_series(1, 10) g;

  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa,
                                 aberto_wa_em, dia_operacional)
  select c.id, v_a, v_chip_a, 'permissao',
         now() - interval '4 days', (now() - interval '4 days')::date
    from public.contatos c where c.nome like 'Mudo %';

  if (select pct_sem_resposta from public.v_saude_chip where chip_id = v_chip_a) = 100.0 then
    raise notice '  ✅ A8a. silêncio já fechado pelo cron continua contando como silêncio';
  else raise warning '  ❌ A8a. pct_sem_resposta = %',
       (select pct_sem_resposta from public.v_saude_chip where chip_id = v_chip_a);
    v_falhas := v_falhas + 1;
  end if;

  if (select farol from public.v_saude_chip where chip_id = v_chip_a) = 'vermelho' then
    raise notice '  ✅ A8b. o farol fica vermelho, em vez de voltar para verde sozinho';
  else raise warning '  ❌ A8b. farol = %',
       (select farol from public.v_saude_chip where chip_id = v_chip_a); v_falhas := v_falhas + 1;
  end if;

  -- Ritmo: 35 conversas na última hora acendem vermelho mesmo sem histórico.
  insert into public.contatos (origem, nome, telefone_e164, chave_dedup, telefone_hmac,
                               status, atendente_id, chip_id, criado_em)
  select 'lista_fria', 'Rajada ' || g,
         '55699300033' || lpad(g::text, 2, '0'),
         '69300033' || lpad(g::text, 2, '0'),
         'hmac-alto-rajada-' || g, 'em_atendimento', v_b, v_chip_b, now() - interval '30 days'
    from generate_series(1, 35) g;

  insert into public.interacoes (contato_id, atendente_id, chip_id, etapa,
                                 aberto_wa_em, dia_operacional)
  select c.id, v_b, v_chip_b, 'material', now() - interval '5 minutes', public.hoje_operacional()
    from public.contatos c where c.nome like 'Rajada %';

  if (select conversas_hora from public.v_saude_chip where chip_id = v_chip_b) >= 35
     and (select farol from public.v_saude_chip where chip_id = v_chip_b) = 'vermelho' then
    raise notice '  ✅ A8c. ritmo alto acende vermelho mesmo em chip sem histórico';
  else raise warning '  ❌ A8c. conversas_hora=% farol=%',
       (select conversas_hora from public.v_saude_chip where chip_id = v_chip_b),
       (select farol from public.v_saude_chip where chip_id = v_chip_b);
    v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- A7 · os totais da lista sobem bloco a bloco
  -- =========================================================================
  insert into public.listas (origem, rotulo, entregue_por, entregue_em, total_linhas)
  values ('lista_fria', 'Lista dos altos', 'Fulano', current_date, 900);

  perform public.somar_totais_lista(
    (select id from public.listas where rotulo = 'Lista dos altos'), 500, 3, 1);
  perform public.somar_totais_lista(
    (select id from public.listas where rotulo = 'Lista dos altos'), 400, 2, 0);

  if (select total_importados = 900 and total_duplicados = 5 and total_bloqueados = 1
             and concluida_em is null
        from public.listas where rotulo = 'Lista dos altos') then
    raise notice '  ✅ A7. cada bloco soma na hora, e a lista fica marcada como inacabada';
  else raise warning '  ❌ A7. %',
       (select to_jsonb(x) from (select total_importados, total_duplicados, total_bloqueados,
                                        concluida_em
                                   from public.listas where rotulo = 'Lista dos altos') x);
    v_falhas := v_falhas + 1;
  end if;

  if v_falhas > 0 then raise exception 'ALTOS: ❌ % falha(s)', v_falhas; end if;
  raise notice 'ALTOS: ✅ tudo passou';
end $$;

rollback;
