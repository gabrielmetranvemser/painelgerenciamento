-- =============================================================================
-- Novo motivo de recusa da fila: `sem_lista`
-- =============================================================================
-- Arquivo separado, e SÓ com isto dentro, por causa do Postgres: um valor novo
-- de enum não pode ser USADO na mesma transação em que foi criado. Como o
-- `supabase db push` roda cada migration numa transação própria, pôr o
-- `alter type` junto das funções que citam 'sem_lista' faria a migration
-- seguinte falhar em metade das versões do servidor. Aqui ele commita sozinho.
--
-- O que o motivo quer dizer: a fila não tem nada para esta pessoa porque ela
-- não está em lista NENHUMA — e isso é diferente de "acabaram os contatos".
-- Sem essa distinção o atendente novo vê "Não há mais contatos na fila" com a
-- base cheia, e o gestor só descobre o esquecimento quando alguém reclama.
alter type public.motivo_fila add value if not exists 'sem_lista';

-- E `lista_nao_e_sua`: o atendente pode escolher trabalhar UMA lista de cada
-- vez, e a escolha chega do navegador. Quem decide se aquela lista é mesmo dele
-- é o servidor — escolha de tela se burla com o DevTools aberto.
alter type public.motivo_fila add value if not exists 'lista_nao_e_sua';
