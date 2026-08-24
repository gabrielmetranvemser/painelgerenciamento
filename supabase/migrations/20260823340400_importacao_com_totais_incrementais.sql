-- =============================================================================
-- A importação deixa de mentir quando a aba fecha no meio
-- =============================================================================
-- ⚠️ A importação roda em blocos de 500 linhas A PARTIR DO NAVEGADOR, e os
--    totais da lista só eram gravados no fim, por `finalizarLista`.
--
-- Fechar a aba, perder a conexão ou o computador dormir no meio de uma planilha
-- de 10 mil linhas deixava o pior estado possível: metade dos contatos JÁ na
-- fila, sendo abordados, e a linha de `listas` com total_importados = 0.
--
-- Isso não é só um número errado num relatório. `listas` é a peça de
-- rastreabilidade da lista fria — quem entregou, quando, quantos entraram. É o
-- que sustenta a defesa se alguém questionar a origem da base
-- (docs/01-VISAO-GERAL.md §9.1). Uma lista que diz "importei zero" com 4.000
-- pessoas sendo atendidas por baixo é exatamente o registro que não se quer
-- ter de explicar.
--
-- Agora cada bloco soma no mesmo instante em que grava, e a lista carrega
-- `concluida_em`. Quem fechou a aba deixa um registro verdadeiro do que entrou
-- e uma marca visível de que a importação não terminou — a tela de importar
-- mostra isso na próxima vez que o gestor abrir.

alter table public.listas
  add column if not exists concluida_em timestamptz;

-- As listas que já existem foram importadas pelo caminho antigo, e todas
-- chegaram ao fim: marcar agora evita um alarme falso na primeira abertura.
update public.listas set concluida_em = criado_em where concluida_em is null;

create index if not exists listas_inacabadas_idx on public.listas (criado_em desc)
  where concluida_em is null;

/**
 * Soma os totais de um bloco recém-gravado.
 *
 * Incremento no banco, e não `update ... set total = <valor lido antes>`: os
 * blocos são sequenciais hoje, mas uma soma feita a partir de um valor lido
 * antes é a receita de perder contagem no dia em que deixarem de ser.
 */
create or replace function public.somar_totais_lista(
  p_lista_id    uuid,
  p_importados  int,
  p_duplicados  int,
  p_bloqueados  int
)
returns void
language sql security definer set search_path = ''
as $$
  update public.listas
     set total_importados = total_importados + greatest(p_importados, 0),
         total_duplicados = total_duplicados + greatest(p_duplicados, 0),
         total_bloqueados = total_bloqueados + greatest(p_bloqueados, 0)
   where id = p_lista_id;
$$;

revoke execute on function public.somar_totais_lista(uuid, int, int, int)
  from anon, public, authenticated;
grant  execute on function public.somar_totais_lista(uuid, int, int, int) to service_role;
