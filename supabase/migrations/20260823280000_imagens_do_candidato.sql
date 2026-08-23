-- =============================================================================
-- Logo e fundo próprios na página do candidato
-- =============================================================================
-- Antes eram campos de URL: o gestor tinha que hospedar a imagem em algum lugar
-- e colar o endereço. Na prática isso vira link do Google Drive que expira, ou
-- imagem de 4 MB puxada de outro site — e a página do candidato, que é onde a
-- pessoa decide se entrega o contato, abre devagar ou quebrada.
--
-- Agora o arquivo entra pelo painel, sai convertido em WebP e fica no
-- armazenamento do próprio projeto.

-- ── Balde público ─────────────────────────────────────────────────────────
-- Público porque a imagem aparece numa página que qualquer pessoa abre; manter
-- privado exigiria assinar cada URL, e URL assinada expira no meio da campanha.
--
-- O que protege é a ESCRITA: só o service_role grava, e quem chama é a ação do
-- gestor. Nenhuma policy de INSERT para anon ou authenticated — sem elas, o
-- RLS de storage.objects nega por padrão.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('candidatos', 'candidatos', true, 2097152, array['image/webp'])
on conflict (id) do update
  set public = true,
      file_size_limit = 2097152,
      allowed_mime_types = array['image/webp'];

drop policy if exists candidatos_leitura_publica on storage.objects;
create policy candidatos_leitura_publica on storage.objects
  for select to anon, authenticated
  using (bucket_id = 'candidatos');

-- ── Colunas ───────────────────────────────────────────────────────────────
alter table public.candidatos
  -- Imagem de fundo da página. Convive com cor_fundo: a cor fica por baixo,
  -- e é ela que aparece enquanto a imagem carrega.
  add column if not exists fundo_url text,
  -- Cor do cartão e dos campos do formulário. Com fundo escolhido pela
  -- campanha, o formulário precisa acompanhar — senão fica um retângulo
  -- cinza-padrão colado por cima da identidade.
  add column if not exists cor_superficie text
    check (cor_superficie is null or cor_superficie ~ '^#[0-9a-fA-F]{6}$');
