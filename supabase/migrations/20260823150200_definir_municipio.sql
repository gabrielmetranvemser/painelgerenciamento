-- O atendente não tem UPDATE em `contatos` (ver rls.sql), então gravar o
-- município que a pessoa informou na conversa precisa de RPC própria.
-- Só município: nenhum outro campo do contato é editável pelo atendente.
create or replace function public.definir_municipio(p_contato_id uuid, p_municipio_id smallint)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  update public.contatos
     set municipio_id = p_municipio_id
   where id = p_contato_id and atendente_id = v_uid;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.definir_municipio(uuid, smallint) from anon, public;
grant  execute on function public.definir_municipio(uuid, smallint) to authenticated;
