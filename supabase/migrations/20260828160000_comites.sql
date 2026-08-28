-- =============================================================================
-- Comitês: onde a pessoa pode buscar material perto dela
-- =============================================================================
-- O pedido veio dos testes: na hora em que a pessoa informa o endereço para
-- receber material impresso, dizer a ela que existe um comitê perto — e quão
-- perto. Vale nas duas telas: a página pública do candidato e a visão do
-- atendente.
--
-- O comitê é POR CANDIDATO. Cada candidatura tem os seus, e a página de um
-- candidato não anuncia o comitê de outro.

create table if not exists public.comites (
  id           uuid primary key default gen_random_uuid(),
  candidato_id uuid not null references public.candidatos(id) on delete cascade,
  nome         text not null check (length(btrim(nome)) between 2 and 80),

  municipio_id smallint references public.municipios(id),
  cep          text check (cep is null or cep ~ '^[0-9]{8}$'),
  rua          text,
  numero       text,
  bairro       text,

  /**
   * Onde o comitê fica, de verdade.
   *
   * ⚠️ Separadas do CEP de propósito. O CEP resolve o endereço, mas em cidade
   * pequena de Rondônia ele é UM SÓ para o município inteiro — o serviço
   * devolve "Ariquemes, RO" e mais nada. Quando isso acontece, a coordenada
   * vem da mão do gestor, colada do Google Maps.
   *
   * Nulas é um estado legítimo e previsto: sem elas a tela não mostra
   * distância, mostra "temos um comitê na sua cidade". Número errado é pior que
   * número nenhum.
   */
  latitude     double precision check (latitude  is null or (latitude  between -34 and 6)),
  longitude    double precision check (longitude is null or (longitude between -74 and -33)),

  /** "Segunda a sexta, 8h às 18h". Texto livre porque cada comitê é um caso. */
  horario      text,
  telefone     text,
  observacao   text,

  ativo        boolean not null default true,
  criado_em    timestamptz not null default now(),

  -- Meia coordenada não é coordenada: com só uma das duas, a conta silenciosa
  -- daria um ponto no meridiano de Greenwich.
  constraint coordenada_completa
    check ((latitude is null) = (longitude is null))
);

create index if not exists comites_candidato_idx
  on public.comites (candidato_id) where ativo;

comment on table public.comites is
  'Pontos físicos de cada candidatura. A distância que as telas mostram é em '
  'LINHA RETA — em Rondônia isso difere bastante da estrada, e o texto diz.';

alter table public.comites enable row level security;

-- O atendente lê (precisa dizer à pessoa onde buscar). Escrever, só o gestor.
create policy comites_leitura on public.comites
  for select to authenticated using (public.sou_ativo());
create policy comites_gestor on public.comites
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

/**
 * Os comitês ativos de um candidato.
 *
 * Função, e não a policy, porque a página PÚBLICA é servida com `service_role`
 * para um eleitor anônimo — a policy de `authenticated` não o alcança.
 *
 * ⚠️ Não devolve `observacao`: é campo interno do gestor ("a chave fica com o
 * Zé"), e a página pública não tem por que carregá-lo.
 */
create or replace function public.comites_do_candidato(p_candidato_id uuid)
returns table (
  id uuid, nome text, municipio text, municipio_id smallint,
  cep text, rua text, numero text, bairro text,
  latitude double precision, longitude double precision,
  horario text, telefone text
)
language sql stable security definer set search_path = ''
as $$
  select c.id, c.nome, m.nome, c.municipio_id,
         c.cep, c.rua, c.numero, c.bairro,
         c.latitude, c.longitude, c.horario, c.telefone
    from public.comites c
    left join public.municipios m on m.id = c.municipio_id
   where c.candidato_id = p_candidato_id and c.ativo
   order by m.nome nulls last, c.nome;
$$;

grant execute on function public.comites_do_candidato(uuid) to anon, authenticated;

/**
 * Todos os comitês que ESTE contato poderia usar.
 *
 * Sai dos candidatos declarados a ele (`contato_candidato`) — a mesma lista
 * congelada do consentimento. Um comitê de candidato que a pessoa nunca ouviu
 * falar não é uma informação útil para ela; é propaganda de alguém que ela não
 * autorizou.
 */
create or replace function public.comites_do_contato(p_contato_id uuid)
returns table (
  id uuid, nome text, candidato text, municipio text, municipio_id smallint,
  cep text, rua text, numero text, bairro text,
  latitude double precision, longitude double precision,
  horario text, telefone text
)
language sql stable security definer set search_path = ''
as $$
  select co.id, co.nome, ca.nome_urna, m.nome, co.municipio_id,
         co.cep, co.rua, co.numero, co.bairro,
         co.latitude, co.longitude, co.horario, co.telefone
    from public.contato_candidato cc
    join public.comites co on co.candidato_id = cc.candidato_id and co.ativo
    join public.candidatos ca on ca.id = co.candidato_id
    left join public.municipios m on m.id = co.municipio_id
   where cc.contato_id = p_contato_id
     and (
       public.is_gestor()
       or exists (
         select 1 from public.contatos ct
          where ct.id = p_contato_id and ct.atendente_id = (select auth.uid())
       )
     )
   order by m.nome nulls last, co.nome;
$$;

revoke execute on function public.comites_do_contato(uuid) from anon, public;
grant  execute on function public.comites_do_contato(uuid) to authenticated;
