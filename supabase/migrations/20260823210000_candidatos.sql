-- =============================================================================
-- Multi-candidato
-- =============================================================================
-- O sistema nasceu com UM candidato, guardado em `config`. Agora um atendente
-- atende vários — um por cargo — e cada candidato tem página, identidade e
-- materiais próprios.

-- ── Cargos da eleição geral ────────────────────────────────────────────────
create type public.cargo_eleitoral as enum (
  'presidente',
  'governador',
  'senador',
  'deputado_federal',
  'deputado_estadual',
  'deputado_distrital'
);

/**
 * Quantos dígitos tem o número de urna de cada cargo. É o mesmo que está na
 * "cola" que o eleitor leva para a seção — e serve para pegar erro de digitação
 * no cadastro, que numa campanha custa material impresso errado.
 */
create or replace function public.digitos_do_cargo(p_cargo public.cargo_eleitoral)
returns int
language sql immutable
as $$
  select case p_cargo
    when 'presidente'         then 2
    when 'governador'         then 2
    when 'senador'            then 3
    when 'deputado_federal'   then 4
    when 'deputado_estadual'  then 5
    when 'deputado_distrital' then 5
  end;
$$;

-- ── Candidatos ─────────────────────────────────────────────────────────────
create table public.candidatos (
  id uuid primary key default gen_random_uuid(),

  -- Endereço público: painel.dominio.com.br/{slug}
  -- Minúsculas, números e hífen. É o que vai no botão do site do candidato.
  slug text not null unique
    check (slug ~ '^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$'),

  -- ── Identificação eleitoral ──────────────────────────────────────────────
  nome_urna     text not null check (length(btrim(nome_urna)) between 2 and 60),
  nome_completo text,
  cargo         public.cargo_eleitoral not null,
  -- Só senador tem duas vagas. É o que permite um atendente atender dois
  -- senadores sem furar a regra de um candidato por cargo.
  vaga          smallint not null default 1 check (vaga in (1, 2)),
  numero        text not null check (numero ~ '^[0-9]+$'),
  uf            char(2),

  partido_sigla  text,
  partido_numero text,
  coligacao      text,

  -- ── Exigências de material de propaganda ─────────────────────────────────
  -- ⚠️ NÃO é parecer jurídico. Estes campos existem para o material poder ser
  -- identificado; QUAIS são obrigatórios e como devem aparecer é pergunta para
  -- o advogado eleitoral, ANTES de qualquer peça circular.
  cnpj_campanha       text,
  responsavel_material text,

  -- ── Identidade visual do link ────────────────────────────────────────────
  cor_tema text check (cor_tema is null or cor_tema ~ '^#[0-9a-fA-F]{6}$'),
  foto_url text,
  slogan   text,

  -- ── Conteúdo da página pública ───────────────────────────────────────────
  chamada  text,
  propostas text,

  ativo     boolean not null default true,
  criado_em timestamptz not null default now(),

  -- O número precisa ter a quantidade de dígitos do cargo.
  constraint numero_bate_com_o_cargo
    check (length(numero) = public.digitos_do_cargo(cargo)),
  -- Fora senador, só existe a 1ª vaga.
  constraint so_senador_tem_segunda_vaga
    check (cargo = 'senador' or vaga = 1),
  -- Existe só para a chave estrangeira composta de atendente_candidatos.
  unique (id, cargo, vaga)
);

create index candidatos_ativos_idx on public.candidatos (ativo, cargo);

-- ── Materiais ──────────────────────────────────────────────────────────────
-- Cada peça ganha link rastreado próprio, então o relatório mostra o que a
-- pessoa realmente abriu — e não só que "clicou no material".
create table public.materiais (
  id           uuid primary key default gen_random_uuid(),
  candidato_id uuid not null references public.candidatos(id) on delete cascade,
  titulo       text not null check (length(btrim(titulo)) between 2 and 80),
  descricao    text,
  url          text not null,
  tipo         text not null default 'outro'
    check (tipo in ('santinho', 'propostas', 'video', 'canal', 'site', 'outro')),
  ordem        int not null default 0,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

create index materiais_candidato_idx on public.materiais (candidato_id, ordem) where ativo;

-- ── Atribuição: quem atende quem ───────────────────────────────────────────
--
-- ⚠️ A REGRA DO PROJETO MORA AQUI, e é o `unique (atendente_id, cargo, vaga)`:
-- um deputado federal, um estadual, um governador, DOIS senadores (1ª e 2ª
-- vaga) e um presidente. Cadastrar um segundo deputado estadual falha no banco.
--
-- `cargo` e `vaga` estão repetidos aqui de propósito: sem eles não dá para
-- escrever a restrição. A chave estrangeira COMPOSTA garante que a cópia não
-- pode divergir do candidato.
create table public.atendente_candidatos (
  atendente_id uuid not null references public.usuarios(id) on delete cascade,
  candidato_id uuid not null references public.candidatos(id) on delete cascade,
  cargo        public.cargo_eleitoral not null,
  vaga         smallint not null,

  -- O candidato citado na PRIMEIRA mensagem, o pedido de permissão. Os demais
  -- se apresentam sozinhos no material de cada um.
  principal    boolean not null default false,

  criado_em    timestamptz not null default now(),

  primary key (atendente_id, candidato_id),
  foreign key (candidato_id, cargo, vaga)
    references public.candidatos (id, cargo, vaga) on delete cascade,
  unique (atendente_id, cargo, vaga)
);

-- Um principal por atendente, no máximo.
create unique index atendente_um_principal_idx
  on public.atendente_candidatos (atendente_id) where principal;

-- ── De qual candidato o contato veio ───────────────────────────────────────
alter table public.contatos
  add column if not exists candidato_origem_id uuid references public.candidatos(id) on delete set null;

create index contatos_candidato_origem_idx on public.contatos (candidato_origem_id)
  where candidato_origem_id is not null;

-- ── Material enviado, por candidato ────────────────────────────────────────
-- A trilha de quem recebeu propaganda de quem, com data. Como a pessoa autoriza
-- conhecendo só o candidato principal, é isto que registra o que de fato foi
-- entregue a ela.
create table public.contato_candidato (
  contato_id          uuid not null references public.contatos(id) on delete cascade,
  candidato_id        uuid not null references public.candidatos(id) on delete cascade,
  material_enviado_em timestamptz,
  atendente_id        uuid references public.usuarios(id) on delete set null,
  chip_id             uuid references public.chips(id) on delete set null,
  criado_em           timestamptz not null default now(),
  primary key (contato_id, candidato_id)
);

create index contato_candidato_cand_idx on public.contato_candidato (candidato_id, material_enviado_em);

-- ── Links passam a apontar para um material ────────────────────────────────
alter table public.links
  add column if not exists material_id uuid references public.materiais(id) on delete cascade;

-- `destino_id` vira opcional: os links novos apontam para material.
alter table public.links alter column destino_id drop not null;

alter table public.links
  add constraint link_tem_um_alvo
    check (num_nonnulls(destino_id, material_id) = 1);

-- Um link por contato e material.
create unique index links_contato_material_idx
  on public.links (contato_id, material_id) where material_id is not null;
