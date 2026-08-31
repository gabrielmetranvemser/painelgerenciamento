-- =============================================================================
-- O gestor passa a ver quem NÃO vai receber contato hoje, e por quê
-- =============================================================================
-- ⚠️ ESTA FUNÇÃO É A LIÇÃO DE 28 A 31/08, e ela não conserta nada — ela CONTA.
--
-- Naqueles dias a operação parou e ninguém conseguiu nomear o motivo. Rodando a
-- fila de cada atendente à mão, em 29/08, o quadro era:
--
--     Thais     sem_lista           a lista dela foi desativada e a nova não foi atribuída
--     Angela    chip_indisponivel   alguém pausou o número dela
--     Laura     ok, 2 na fila       a lista de 556 contatos tinha sido desativada
--     Mariana   ok, 11 na fila      a lista de 698 estava ativa e sem atendente
--
-- Nada disso era defeito de código: eram quatro configurações, cada uma numa
-- tela diferente, e nenhuma delas aparecia junto. O gestor via "o atendente diz
-- que não vem contato" e não tinha onde olhar.
--
-- `is_gestor()` no `where` e não num `if`: assim um atendente que chame isto
-- recebe zero linhas, e não um erro que ele não sabe o que fazer com.
create or replace function public.quem_nao_recebe_contato()
returns table (
  atendente_id   uuid,
  primeiro_nome  text,
  motivo         text,
  na_fila        int,
  listas_ativas  int,
  chips_vivos    int,
  tem_chapa      boolean
)
language sql stable security definer set search_path = ''
as $$
  with base as (
    select u.id, u.primeiro_nome,
           exists (select 1 from public.atendente_candidatos ac where ac.atendente_id = u.id)
             as tem_chapa,
           (select count(*)::int
              from public.atendente_listas al
              join public.listas l on l.id = al.lista_id
             where al.atendente_id = u.id and l.ativa) as listas_ativas,
           (select count(*)::int
              from public.chips c
             where c.atendente_id = u.id
               and c.status not in ('morto', 'pausado')
               and (c.pausado_ate is null or c.pausado_ate <= now())) as chips_vivos,
           (select count(*)::int
              from public.contatos c
             where c.status = 'na_fila'
               and c.telefone_e164 is not null
               and (c.adiado_ate is null or c.adiado_ate <= now())
               and (c.atendente_id is null or c.atendente_id = u.id)
               and not exists (select 1 from public.bloqueios b
                                where b.telefone_hmac = c.telefone_hmac)
               and (
                 c.lista_id is null
                 or exists (select 1
                              from public.atendente_listas al
                              join public.listas l on l.id = al.lista_id
                             where al.atendente_id = u.id
                               and al.lista_id = c.lista_id
                               and l.ativa)
               )) as na_fila
      from public.usuarios u
     where u.papel = 'atendente' and u.ativo and public.is_gestor()
  )
  select b.id, b.primeiro_nome,
         case
           when not b.tem_chapa       then 'sem_candidato'
           when b.chips_vivos = 0     then 'sem_numero'
           when b.listas_ativas = 0   then 'sem_lista'
           when b.na_fila = 0         then 'fila_vazia'
           else 'ok'
         end,
         b.na_fila, b.listas_ativas, b.chips_vivos, b.tem_chapa
    from base b
   order by
     -- Quem está travado primeiro, e dentro disso quem tem menos fila.
     (case when b.tem_chapa and b.chips_vivos > 0 and b.listas_ativas > 0
                and b.na_fila > 0 then 1 else 0 end),
     b.na_fila,
     b.primeiro_nome;
$$;

revoke execute on function public.quem_nao_recebe_contato() from anon, public;
grant  execute on function public.quem_nao_recebe_contato() to authenticated;

-- ── E as listas ativas que ninguém atende ───────────────────────────────────
-- O outro lado do mesmo problema: em 29/08 havia 6 listas ativas, com milhares
-- de contatos, sem nenhum atendente marcado. Contato parado numa lista órfã não
-- aparece em lugar nenhum — a base "tem 14 mil pessoas" e a fila está vazia.
create or replace function public.listas_sem_atendente()
returns table (lista_id uuid, rotulo text, contatos int)
language sql stable security definer set search_path = ''
as $$
  select l.id, l.rotulo,
         (select count(*)::int from public.contatos c
           where c.lista_id = l.id and c.status = 'na_fila')
    from public.listas l
   where l.ativa
     and public.is_gestor()
     and not exists (select 1 from public.atendente_listas al where al.lista_id = l.id)
     and exists (select 1 from public.contatos c
                  where c.lista_id = l.id and c.status = 'na_fila')
   order by 3 desc;
$$;

revoke execute on function public.listas_sem_atendente() from anon, public;
grant  execute on function public.listas_sem_atendente() to authenticated;
