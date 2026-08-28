begin;
-- Defesa: se algum contato REAL tiver sido pego durante o teste, devolve para
-- a fila em vez de deixar preso em atendimento com atendente apagado.
update public.contatos
   set status = 'na_fila', atendente_id = null, chip_id = null,
       claimed_at = null, claim_expira_em = null
 where status = 'em_atendimento'
   and nome not like 'Contato Teste %'
   and chip_id in (select id from public.chips where rotulo like 'Chip Teste %');

delete from public.interacoes where contato_id in (select id from public.contatos where nome like 'Contato Teste %');
delete from public.bloqueios where telefone_hmac like 'hmac-teste-%';
delete from public.contatos where telefone_hmac like 'hmac-teste-%';
delete from public.listas   where rotulo = 'teste-lista-fria';
delete from public.chips    where rotulo like 'Chip Teste %';
delete from public.usuarios where id in (select id from auth.users where email like 'teste-atendente-%@painel.local');
delete from auth.users      where email like 'teste-atendente-%@painel.local';
-- Depois dos usuários: `atendente_candidatos` cai por cascata quando o
-- atendente sai, e só então o candidato fica sem referência.
delete from public.candidatos where slug = 'teste-candidato';
commit;
