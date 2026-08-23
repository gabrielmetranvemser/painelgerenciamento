-- =============================================================================
-- O que ainda falta entregar a um contato, candidato por candidato
-- =============================================================================
-- A tela do atendente precisa responder três coisas de uma vez: de quais
-- candidatos esta pessoa foi avisada, para quais já saiu material, e quais
-- sequer têm peça cadastrada. Sem isso o atendente clica num botão que o
-- servidor vai recusar, e não entende por quê.

-- A ordem de leitura da chapa, igual à da "cola" que o eleitor leva à seção.
-- Estava repetida dentro de chapa_do_atendente; agora tem um lugar só.
create or replace function public.ordem_do_cargo(p_cargo public.cargo_eleitoral)
returns int
language sql immutable
as $$
  select case p_cargo
    when 'deputado_federal'   then 1
    when 'deputado_estadual'  then 2
    when 'deputado_distrital' then 2
    when 'senador'            then 3
    when 'governador'         then 4
    when 'presidente'         then 5
  end;
$$;

create or replace function public.chapa_do_atendente(p_atendente uuid)
returns table (
  candidato_id uuid, nome_urna text, cargo public.cargo_eleitoral, vaga smallint,
  numero text, partido_sigla text, principal boolean
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.nome_urna, c.cargo, c.vaga, c.numero, c.partido_sigla, ac.principal
    from public.atendente_candidatos ac
    join public.candidatos c on c.id = ac.candidato_id
   where ac.atendente_id = p_atendente and c.ativo
   order by ac.principal desc, public.ordem_do_cargo(c.cargo), c.vaga;
$$;

/**
 * Os candidatos DECLARADOS a este contato, com o que falta entregar.
 *
 * A lista sai de `contato_candidato`, não da chapa atual do atendente: é o
 * congelamento do consentimento. Quem entrou na chapa depois da permissão não
 * aparece aqui, e é assim que tem de ser — aquela pessoa nunca foi avisada
 * dele.
 *
 * `materiais` e `canais` existem para a tela conseguir avisar ANTES do clique.
 * Um candidato sem peça ativa monta uma mensagem que anuncia material e não
 * traz link nenhum; o atendente só descobriria isso com o texto já aberto no
 * WhatsApp.
 */
create or replace function public.candidatos_do_contato(p_contato_id uuid)
returns table (
  candidato_id        uuid,
  nome_urna           text,
  cargo               public.cargo_eleitoral,
  numero              text,
  partido_sigla       text,
  ativo               boolean,
  principal           boolean,
  material_enviado_em timestamptz,
  materiais           int,
  canais              int
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.nome_urna, c.cargo, c.numero, c.partido_sigla, c.ativo,
         coalesce(ac.principal, false),
         cc.material_enviado_em,
         (select count(*)::int from public.materiais m
           where m.candidato_id = c.id and m.ativo),
         (select count(*)::int from public.materiais m
           where m.candidato_id = c.id and m.ativo and m.tipo = 'canal')
    from public.contato_candidato cc
    join public.candidatos c on c.id = cc.candidato_id
    left join public.atendente_candidatos ac
           on ac.candidato_id = c.id and ac.atendente_id = (select auth.uid())
   where cc.contato_id = p_contato_id
     -- Dono do contato ou gestor. Sem isto, um atendente leria a trilha de
     -- propaganda dos contatos dos outros.
     and (
       public.is_gestor()
       or exists (
         select 1 from public.contatos ct
          where ct.id = p_contato_id and ct.atendente_id = (select auth.uid())
       )
     )
   order by coalesce(ac.principal, false) desc,
            public.ordem_do_cargo(c.cargo),
            c.nome_urna;
$$;

revoke execute on function public.candidatos_do_contato(uuid) from anon, public;
grant  execute on function public.candidatos_do_contato(uuid) to authenticated;
