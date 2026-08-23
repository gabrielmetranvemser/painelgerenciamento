begin;
delete from public.interacoes where contato_id in (select id from public.contatos where nome like 'Contato Teste %');
delete from public.bloqueios where telefone_hmac like 'hmac-teste-%';
delete from public.contatos where telefone_hmac like 'hmac-teste-%';
delete from public.listas   where rotulo = 'teste-lista-fria';
delete from public.chips    where rotulo like 'Chip Teste %';
delete from public.usuarios where id in (select id from auth.users where email like 'teste-atendente-%@painel.local');
delete from auth.users      where email like 'teste-atendente-%@painel.local';
commit;
