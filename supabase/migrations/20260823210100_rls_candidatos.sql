-- =============================================================================
-- RLS das tabelas de candidato
-- =============================================================================

alter table public.candidatos            enable row level security;
alter table public.materiais             enable row level security;
alter table public.atendente_candidatos  enable row level security;
alter table public.contato_candidato     enable row level security;

-- ── Candidatos e materiais ─────────────────────────────────────────────────
-- Todo atendente ativo lê: a mensagem que ele manda cita nome, cargo, número e
-- partido, e a tela precisa desses dados. Escrever, só o gestor.
--
-- A página pública do candidato NÃO usa estas policies: ela é servida pela
-- rota com service_role, então o anônimo continua sem enxergar a tabela.
create policy candidatos_leitura on public.candidatos
  for select to authenticated using (public.sou_ativo());
create policy candidatos_gestor on public.candidatos
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

create policy materiais_leitura on public.materiais
  for select to authenticated using (public.sou_ativo());
create policy materiais_gestor on public.materiais
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── Atribuição ─────────────────────────────────────────────────────────────
-- O atendente vê a própria chapa. Quem define é o gestor — deixar o atendente
-- escrever aqui seria deixá-lo escolher para quem faz propaganda.
create policy atribuicao_minha on public.atendente_candidatos
  for select to authenticated
  using (atendente_id = (select auth.uid()) or public.is_gestor());
create policy atribuicao_gestor on public.atendente_candidatos
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- ── Material enviado por contato ───────────────────────────────────────────
-- Leitura pelos próprios contatos. A escrita é só por RPC: é trilha de
-- auditoria de quem recebeu propaganda de quem, e trilha que o próprio
-- interessado edita não serve de trilha.
create policy contato_candidato_meus on public.contato_candidato
  for select to authenticated
  using (
    public.is_gestor()
    or exists (
      select 1 from public.contatos c
       where c.id = contato_candidato.contato_id
         and c.atendente_id = (select auth.uid())
    )
  );
create policy contato_candidato_gestor on public.contato_candidato
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());
