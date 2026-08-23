-- =============================================================================
-- Suporte: o atendente fala com o gestor, com print e contexto
-- =============================================================================
-- Hoje o atendente que recebe uma intimação, ou vê o painel travar, manda
-- mensagem para o gestor por fora — e o gestor descobre por WhatsApp pessoal,
-- sem print, sem saber de qual contato se trata. O que se perde ali não é
-- comodidade: é o registro de um risco jurídico, na hora em que ele apareceu.

create type public.motivo_chamado as enum (
  'tecnico',    -- painel, extensão, WhatsApp Web
  'contato',    -- algo sobre uma pessoa específica da fila
  'juridico',   -- intimação, ameaça de denúncia, advogado
  'material',   -- link quebrado, peça errada, texto com problema
  'outro'
);

create type public.status_chamado as enum ('aberto', 'em_analise', 'resolvido');

create table public.chamados (
  id           uuid primary key default gen_random_uuid(),
  atendente_id uuid not null references public.usuarios(id) on delete cascade,
  motivo       public.motivo_chamado not null,
  assunto      text not null check (length(btrim(assunto)) between 3 and 140),

  -- Qual pessoa da fila, quando o assunto é uma delas. `set null` porque o
  -- contato pode ser purgado pela LGPD antes de o chamado ser resolvido — e
  -- perder o chamado junto apagaria o registro do risco.
  contato_id   uuid references public.contatos(id) on delete set null,
  chip_id      uuid references public.chips(id) on delete set null,

  status       public.status_chamado not null default 'aberto',
  criado_em    timestamptz not null default now(),
  respondido_em timestamptz,
  resolvido_em  timestamptz,
  resolvido_por uuid references public.usuarios(id) on delete set null
);

create index chamados_abertos_idx on public.chamados (status, motivo, criado_em desc);
create index chamados_do_atendente_idx on public.chamados (atendente_id, criado_em desc);

-- ── A conversa ────────────────────────────────────────────────────────────
-- Thread, e não um campo de resposta só: a primeira pergunta do gestor é
-- sempre "de qual número?" ou "o que aparecia na tela?", e sem ida e volta o
-- atendente responde por fora — que é justamente o que isto veio resolver.
create table public.chamado_mensagens (
  id         uuid primary key default gen_random_uuid(),
  chamado_id uuid not null references public.chamados(id) on delete cascade,
  autor_id   uuid references public.usuarios(id) on delete set null,
  texto      text not null check (length(btrim(texto)) between 1 and 4000),
  criado_em  timestamptz not null default now()
);

create index chamado_mensagens_idx on public.chamado_mensagens (chamado_id, criado_em);

-- ── Os prints ─────────────────────────────────────────────────────────────
create table public.chamado_anexos (
  id          uuid primary key default gen_random_uuid(),
  chamado_id  uuid not null references public.chamados(id) on delete cascade,
  mensagem_id uuid references public.chamado_mensagens(id) on delete set null,
  autor_id    uuid references public.usuarios(id) on delete set null,
  caminho     text not null unique,   -- dentro do balde `suporte`
  bytes       int not null,
  largura     int,
  altura      int,
  criado_em   timestamptz not null default now()
);

create index chamado_anexos_idx on public.chamado_anexos (chamado_id, criado_em);

-- ── Balde PRIVADO ─────────────────────────────────────────────────────────
--
-- ⚠️ Diferente do balde `candidatos`, este NÃO é público, e a diferença não é
-- estilística: um print de conversa carrega nome, telefone e o texto que o
-- eleitor escreveu. Balde público seria publicar a conversa de alguém numa URL
-- que qualquer um abre — e URL de storage não expira nem esquece.
--
-- Sem policy de SELECT para anon nem para authenticated: quem lê é a rota do
-- painel, que confere de quem é o chamado e devolve um link assinado curto.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('suporte', 'suporte', false, 3145728, array['image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = 3145728,
      allowed_mime_types = array['image/webp'];

-- ── RLS ───────────────────────────────────────────────────────────────────
alter table public.chamados          enable row level security;
alter table public.chamado_mensagens enable row level security;
alter table public.chamado_anexos    enable row level security;

-- Leitura: o dono do chamado e o gestor. Escrita, só por RPC — chamado que o
-- próprio interessado edita depois não serve de registro de risco.
create policy chamados_meus on public.chamados
  for select to authenticated
  using (atendente_id = (select auth.uid()) or public.is_gestor());

create policy chamado_mensagens_minhas on public.chamado_mensagens
  for select to authenticated
  using (
    public.is_gestor()
    or exists (select 1 from public.chamados c
                where c.id = chamado_mensagens.chamado_id
                  and c.atendente_id = (select auth.uid()))
  );

create policy chamado_anexos_meus on public.chamado_anexos
  for select to authenticated
  using (
    public.is_gestor()
    or exists (select 1 from public.chamados c
                where c.id = chamado_anexos.chamado_id
                  and c.atendente_id = (select auth.uid()))
  );
