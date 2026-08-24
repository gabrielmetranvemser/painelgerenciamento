-- O aceite do termo, feito por um ATENDENTE.
--
-- Este arquivo existe por causa de um bug de produção: o aceite era um
-- `update usuarios` com a sessão do próprio usuário, e atendente não tem policy
-- de UPDATE nessa tabela. O RLS não recusa — a linha simplesmente não existe
-- para ele, o UPDATE acerta zero linhas e volta com sucesso. O atendente
-- aceitava, era mandado para o painel, o painel via que não havia aceite e o
-- mandava de volta. Em círculo.
--
-- Passou porque todo teste anterior usava conta de gestor, onde a policy ALL
-- faz o mesmo código funcionar. Daqui em diante, o caminho do atendente é
-- coberto.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
begin;

-- ⚠️ A janela de horário abre para o teste inteiro (revertida pelo rollback).
--
-- As travas de verdade recusam envio fora do horário de operação, então esta
-- suíte só passava entre 9h e 20h de Porto Velho: rodá-la às 21h devolvia uma
-- parede de ❌ que não eram falhas. Um teste que só roda no horário comercial é
-- um teste que ninguém roda antes de subir código à noite — que é exatamente
-- quando se sobe código.
update public.config set hora_inicio = 0, hora_fim = 24 where id = 1;

do $$
declare
  v_atendente uuid := gen_random_uuid();
  v_gestor    uuid := gen_random_uuid();
  v_r         jsonb;
  v_linhas    int;
  v_falhas    int := 0;
begin
  raise notice '── Aceite do termo ──────────────────────────────────────────────────────';

  insert into auth.users (
    instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
    created_at, updated_at, raw_app_meta_data, raw_user_meta_data, is_super_admin,
    confirmation_token, recovery_token, email_change_token_new, email_change
  )
  select '00000000-0000-0000-0000-000000000000', x.id, 'authenticated', 'authenticated',
         x.email, extensions.crypt('x', extensions.gen_salt('bf')), now(), now(), now(),
         '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    from (values (v_atendente, 'termo-at@painel.local'), (v_gestor, 'termo-ge@painel.local')) as x(id, email);

  insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em)
  values (v_atendente, 'atendente', 'TermoAt', true, null),
         (v_gestor,    'gestor',    'TermoGe', true, null);

  perform set_config('request.jwt.claims',
    json_build_object('sub', v_atendente, 'role', 'authenticated')::text, true);

  -- ── 1. O caminho antigo mente ────────────────────────────────────────────
  -- Nenhum erro, nenhuma linha. É exatamente o que enganava a tela.
  --
  -- `set local role authenticated` não é detalhe: o psql do teste conecta como
  -- superusuário, e superusuário IGNORA RLS. Sem trocar de papel, este teste
  -- mediria o oposto do que a aplicação vive — e foi assim que ele passou
  -- verde na primeira tentativa, medindo nada.
  execute 'set local role authenticated';
  update public.usuarios set termo_aceito_em = now() where id = v_atendente;
  get diagnostics v_linhas = row_count;
  execute 'reset role';

  if v_linhas = 0 and (select termo_aceito_em is null from public.usuarios where id = v_atendente) then
    raise notice '  ✅ 1. `update` direto do atendente acerta ZERO linhas, sem erro nenhum';
  else raise warning '  ❌ 1. o update direto acertou % linha(s) — a premissa mudou', v_linhas;
    v_falhas := v_falhas + 1;
  end if;

  -- ── 2. A RPC grava de verdade ────────────────────────────────────────────
  v_r := public.aceitar_termo();
  if (v_r->>'ok')::boolean
     and (select termo_aceito_em is not null from public.usuarios where id = v_atendente) then
    raise notice '  ✅ 2. a RPC grava o aceite do atendente, com data e hora';
  else raise warning '  ❌ 2. a RPC não gravou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 3. A versão do termo fica registrada ─────────────────────────────────
  -- Sem versão, mudar o texto do termo não teria como exigir novo aceite.
  if (select u.termo_versao = c.termo_versao from public.usuarios u, public.config c
       where u.id = v_atendente and c.id = 1) then
    raise notice '  ✅ 3. grava a versão do termo que estava valendo no aceite';
  else raise warning '  ❌ 3. versão do termo errada'; v_falhas := v_falhas + 1;
  end if;

  -- ── 4. Aceitar destrava a fila ───────────────────────────────────────────
  -- É o efeito que importa: sem aceite, `fila_status` recusa entregar contato.
  update public.usuarios set termo_aceito_em = null where id = v_atendente;
  if (public.fila_status(null)->>'motivo') = 'termo_nao_aceito' then
    perform public.aceitar_termo();
    if (public.fila_status(null)->>'motivo') <> 'termo_nao_aceito' then
      raise notice '  ✅ 4. sem aceite a fila recusa; com aceite ela destrava';
    else raise warning '  ❌ 4. aceitou e a fila continuou travada'; v_falhas := v_falhas + 1;
    end if;
  else raise warning '  ❌ 4. a fila não estava travando por termo'; v_falhas := v_falhas + 1;
  end if;

  -- ── 5. Conta inativa não aceita ──────────────────────────────────────────
  -- Registrar consentimento de quem o gestor já tirou da operação seria criar
  -- uma prova de aceite que não vale nada.
  update public.usuarios set ativo = false, termo_aceito_em = null where id = v_atendente;
  v_r := public.aceitar_termo();
  if v_r->>'motivo' = 'usuario_inativo'
     and (select termo_aceito_em is null from public.usuarios where id = v_atendente) then
    raise notice '  ✅ 5. conta inativa não consegue aceitar o termo';
  else raise warning '  ❌ 5. conta inativa aceitou: %', v_r; v_falhas := v_falhas + 1;
  end if;

  -- ── 6. Cada um aceita por si ─────────────────────────────────────────────
  -- A RPC é `security definer`: precisa marcar QUEM chamou, e ninguém mais.
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_gestor, 'role', 'authenticated')::text, true);
  update public.usuarios set ativo = true where id = v_atendente;
  perform public.aceitar_termo();
  if (select termo_aceito_em is not null from public.usuarios where id = v_gestor)
     and (select termo_aceito_em is null from public.usuarios where id = v_atendente) then
    raise notice '  ✅ 6. o aceite marca só quem chamou, nunca outro usuário';
  else raise warning '  ❌ 6. o aceite vazou para outro usuário'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'TERMO: ✅ as 6 passaram';
  else raise exception 'TERMO: ❌ % falharam', v_falhas;
  end if;
end $$;

rollback;
