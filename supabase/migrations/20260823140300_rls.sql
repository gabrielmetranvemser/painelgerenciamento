-- =============================================================================
-- Row Level Security
-- =============================================================================
-- Sem RLS, qualquer atendente lê a base inteira pelo navegador — a anon key
-- está no bundle do frontend, por definição.
--
-- PRINCÍPIO: o atendente NÃO ESCREVE em `contatos`, nem nas próprias linhas.
-- Toda mutação passa por RPC `security definer` que revalida as travas.
-- A policy do documento (§4) permitia `atendente_id = auth.uid()` no UPDATE,
-- o que deixaria um atendente se AUTO-ATRIBUIR qualquer contato da base.

-- ── Quem é gestor ───────────────────────────────────────────────────────────
-- Função `security definer` em vez de subconsulta na policy: consultar
-- `usuarios` direto de dentro de uma policy de `usuarios` causa recursão
-- infinita (erro 42P17). `stable` permite ao planner chamar uma vez por query.
create or replace function public.is_gestor()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = (select auth.uid())
      and u.papel = 'gestor'
      and u.ativo
  );
$$;

create or replace function public.sou_ativo()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.usuarios u
    where u.id = (select auth.uid()) and u.ativo
  );
$$;

revoke execute on function public.is_gestor() from anon;
revoke execute on function public.sou_ativo() from anon;

-- ── Habilitar RLS em tudo ───────────────────────────────────────────────────
alter table public.config          enable row level security;
alter table public.dias_bloqueados enable row level security;
alter table public.municipios      enable row level security;
alter table public.usuarios        enable row level security;
alter table public.chips           enable row level security;
alter table public.listas          enable row level security;
alter table public.modelos         enable row level security;
alter table public.variacoes       enable row level security;
alter table public.rotacao_chip    enable row level security;
alter table public.destinos        enable row level security;
alter table public.contatos        enable row level security;
alter table public.interacoes      enable row level security;
alter table public.bloqueios       enable row level security;
alter table public.links           enable row level security;
alter table public.cliques         enable row level security;
alter table public.captacoes       enable row level security;
alter table public.alertas         enable row level security;

-- Sem policy = nada passa. As tabelas abaixo são gravadas exclusivamente pelo
-- servidor (service_role, que ignora RLS): bloqueios, cliques, captacoes.
-- A landing grava sem login, então a escrita não pode existir para o cliente.

-- ── Leitura que todo mundo autenticado precisa ──────────────────────────────
-- O atendente precisa do texto e das regras para a tela funcionar.
create policy config_leitura on public.config
  for select to authenticated using (public.sou_ativo());
create policy config_gestor on public.config
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy municipios_leitura on public.municipios
  for select to authenticated using (true);
create policy municipios_gestor on public.municipios
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy dias_leitura on public.dias_bloqueados
  for select to authenticated using (public.sou_ativo());
create policy dias_gestor on public.dias_bloqueados
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy modelos_leitura on public.modelos
  for select to authenticated using (public.sou_ativo());
create policy modelos_gestor on public.modelos
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy variacoes_leitura on public.variacoes
  for select to authenticated using (public.sou_ativo());
create policy variacoes_gestor on public.variacoes
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy destinos_leitura on public.destinos
  for select to authenticated using (public.sou_ativo());
create policy destinos_gestor on public.destinos
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── Usuários ────────────────────────────────────────────────────────────────
-- O atendente lê o próprio cadastro (nome, se aceitou o termo). O gestor
-- gerencia todos. Ninguém se promove a gestor: a coluna `papel` só muda por
-- rota de servidor com service_role.
create policy usuarios_proprio on public.usuarios
  for select to authenticated using (id = (select auth.uid()) or public.is_gestor());

create policy usuarios_gestor on public.usuarios
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── Chips ───────────────────────────────────────────────────────────────────
create policy chips_proprios on public.chips
  for select to authenticated
  using (atendente_id = (select auth.uid()) or public.is_gestor());

create policy chips_gestor on public.chips
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── Contatos ────────────────────────────────────────────────────────────────
-- LEITURA apenas, e só do que é meu. Nenhuma policy de INSERT/UPDATE/DELETE
-- para o atendente: sem policy, a operação é negada. As mutações vivem em
-- pegar_proximo_contato / registrar_abertura / registrar_resultado.
create policy contatos_meus on public.contatos
  for select to authenticated
  using (atendente_id = (select auth.uid()) or public.is_gestor());

create policy contatos_gestor on public.contatos
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── Interações ──────────────────────────────────────────────────────────────
create policy interacoes_minhas on public.interacoes
  for select to authenticated
  using (atendente_id = (select auth.uid()) or public.is_gestor());

create policy interacoes_gestor on public.interacoes
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── Listas, rotação, links, alertas ─────────────────────────────────────────
create policy listas_gestor on public.listas
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy rotacao_gestor on public.rotacao_chip
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy links_leitura on public.links
  for select to authenticated
  using (public.is_gestor()
         or exists (select 1 from public.contatos c
                    where c.id = links.contato_id
                      and c.atendente_id = (select auth.uid())));

create policy links_gestor on public.links
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy alertas_meus on public.alertas
  for select to authenticated
  using (atendente_id = (select auth.uid()) or public.is_gestor());

create policy alertas_gestor on public.alertas
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── Relatórios do gestor sobre tabelas de escrita-servidor ──────────────────
create policy cliques_gestor on public.cliques
  for select to authenticated using (public.is_gestor());

create policy captacoes_gestor on public.captacoes
  for select to authenticated using (public.is_gestor());

-- `bloqueios` fica sem policy nenhuma: nem o gestor lê pelo cliente. É a tabela
-- que existe justamente para NÃO ser consultada por pessoas — só a função de
-- fila a usa, por dentro.
