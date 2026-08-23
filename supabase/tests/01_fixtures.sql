-- Fixtures de teste. Tudo marcado com o prefixo 'teste-' e removido por
-- 99_limpeza.sql. Não deixar rodar com dados reais na base.
begin;

-- 10 atendentes, 1 chip cada
do $$
declare
  i int;
  v_uid uuid;
  v_chip uuid;
begin
  for i in 1..10 loop
    v_uid := gen_random_uuid();

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password,
      email_confirmed_at, created_at, updated_at,
      raw_app_meta_data, raw_user_meta_data, is_super_admin,
      confirmation_token, recovery_token, email_change_token_new, email_change
    ) values (
      '00000000-0000-0000-0000-000000000000', v_uid, 'authenticated', 'authenticated',
      'teste-atendente-' || i || '@painel.local',
      extensions.crypt('senha-de-teste', extensions.gen_salt('bf')),
      now(), now(), now(),
      '{"provider":"email","providers":["email"]}', '{}', false, '', '', '', ''
    );

    insert into public.usuarios (id, papel, primeiro_nome, ativo, termo_aceito_em, termo_versao)
    values (v_uid, 'atendente', 'Teste' || i, true, now(), 1);

    insert into public.chips (atendente_id, rotulo, papel, status)
    values (v_uid, 'Chip Teste ' || i, 'ativo', 'ativo')
    returning id into v_chip;
  end loop;
end $$;

-- 10 contatos na fila: 3 quentes e 7 frios, para conferir a ordem também.
insert into public.listas (origem, rotulo, entregue_por, entregue_em)
values ('lista_fria', 'teste-lista-fria', 'Fornecedor de Teste', current_date);

insert into public.contatos (origem, nome, primeiro_nome, telefone_e164, chave_dedup, telefone_hmac, status, criado_em, lista_id)
select
  case when g <= 3 then 'site'::public.origem_contato else 'lista_fria'::public.origem_contato end,
  'Contato Teste ' || g,
  'Teste',
  '55699' || lpad(g::text, 8, '0'),
  '69' || lpad(g::text, 8, '0'),
  'hmac-teste-' || lpad(g::text, 4, '0'),
  'na_fila',
  now() + make_interval(secs => g),
  (select id from public.listas where rotulo = 'teste-lista-fria')
from generate_series(1, 10) g;

commit;
