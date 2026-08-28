-- =============================================================================
-- Os itens que a pessoa pode pedir passam a ser cadastro, não código
-- =============================================================================
-- "Santinho, adesivo de carro, camiseta" estavam escritos à mão em CINCO
-- lugares do código: a validação do formulário público, o próprio formulário,
-- o botão de adicionar contato, o perfil do contato e o rótulo da tela de
-- entregas. Acrescentar "boné" era um deploy, e esquecer um dos cinco lugares
-- era um item que aparece na tela e o servidor recusa.
--
-- `pede_tamanho` existe para substituir o `if (itens.includes('camiseta'))`
-- que estava escrito à mão em três telas — é a camiseta que pergunta tamanho,
-- e amanhã pode ser a camiseta e o boné.

create table if not exists public.itens_kit (
  -- A chave é o que fica gravado em `captacoes.itens` (um `text[]`), então ela
  -- é para sempre: mudar a chave de um item já pedido cria linha de relatório
  -- que ninguém consegue ler.
  chave        text primary key check (chave ~ '^[a-z][a-z0-9_]{1,29}$'),
  rotulo       text not null check (length(btrim(rotulo)) between 2 and 40),
  /** Se pedir este item deve perguntar o tamanho da camiseta. */
  pede_tamanho boolean not null default false,
  ordem        int not null default 0,
  ativo        boolean not null default true,
  criado_em    timestamptz not null default now()
);

comment on table public.itens_kit is
  'O que a pessoa pode pedir de material impresso. A chave fica gravada em '
  'captacoes.itens e nunca deve ser trocada — só desativada.';

-- Os três que já existiam, com as MESMAS chaves que estão gravadas em
-- `captacoes.itens` hoje. Trocar qualquer uma quebraria os relatórios antigos.
insert into public.itens_kit (chave, rotulo, pede_tamanho, ordem) values
  ('santinho', 'Santinho',          false, 1),
  ('adesivo',  'Adesivo de carro',  false, 2),
  ('camiseta', 'Camiseta',          true,  3)
on conflict (chave) do nothing;

alter table public.itens_kit enable row level security;

-- Todo autenticado ativo LÊ: o atendente precisa da lista para anotar o pedido.
-- Escrever, só o gestor.
create policy itens_kit_leitura on public.itens_kit
  for select to authenticated using (public.sou_ativo());
create policy itens_kit_gestor on public.itens_kit
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

/**
 * Os itens que a página PÚBLICA do candidato oferece.
 *
 * A página é servida com `service_role` e o eleitor é anônimo — por isso uma
 * função, e não a policy de leitura. Devolve só o que está ativo: item
 * desativado some da tela nova, mas continua legível nos relatórios antigos.
 */
create or replace function public.itens_kit_ativos()
returns table (chave text, rotulo text, pede_tamanho boolean)
language sql stable security definer set search_path = ''
as $$
  select i.chave, i.rotulo, i.pede_tamanho
    from public.itens_kit i
   where i.ativo
   order by i.ordem, i.rotulo;
$$;

grant execute on function public.itens_kit_ativos() to anon, authenticated;
