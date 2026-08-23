-- =============================================================================
-- O aceite do termo passa por RPC
-- =============================================================================
-- ⚠️ Este era um bug de produção, e do tipo pior: silencioso.
--
-- A tela gravava o aceite com `update usuarios set termo_aceito_em = now()`
-- usando a sessão do próprio usuário. Só que as policies de `usuarios` são:
--
--   usuarios_proprio  SELECT  (id = auth.uid() or is_gestor())
--   usuarios_gestor   ALL     (is_gestor())
--
-- Atendente não tem policy de UPDATE. O RLS não recusa a operação — ele apenas
-- faz a linha não existir para aquele usuário, e o UPDATE acerta ZERO linhas.
-- O PostgREST devolve sucesso: não há erro, porque não houve erro.
--
-- A tela então redirecionava para o painel, o layout via `termo_aceito_em`
-- nulo e mandava de volta para o termo. O atendente aceitava, aceitava, e
-- nunca entrava. Passou despercebido porque só foi testado com conta de
-- gestor, onde a policy ALL faz o mesmo código funcionar.
--
-- Agora é `security definer`, como toda mutação sensível deste projeto, e
-- devolve o que aconteceu em vez de deixar o silêncio parecer sucesso.
create or replace function public.aceitar_termo()
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid    uuid := (select auth.uid());
  v_versao int;
  v_quando timestamptz;
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'sem_sessao');
  end if;

  select termo_versao into v_versao from public.config where id = 1;

  update public.usuarios
     set termo_aceito_em = now(),
         termo_versao    = coalesce(v_versao, 1)
   where id = v_uid and ativo
   returning termo_aceito_em into v_quando;

  -- Conta inativa não aceita termo: seria registrar o consentimento de quem o
  -- gestor já tirou da operação.
  if v_quando is null then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inativo');
  end if;

  return jsonb_build_object('ok', true, 'aceito_em', v_quando, 'versao', coalesce(v_versao, 1));
end;
$$;

revoke execute on function public.aceitar_termo() from anon, public;
grant  execute on function public.aceitar_termo() to authenticated;
