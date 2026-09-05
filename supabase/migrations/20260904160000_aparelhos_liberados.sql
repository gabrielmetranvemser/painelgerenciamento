-- =============================================================================
-- Aparelhos liberados: sem marca no aparelho, o painel não existe
-- =============================================================================
-- Camada pedida por quem opera: "criar algo muito fechado, que só quem sabe
-- acessa". Hoje quem descobre a URL por acaso vê a tela de login — não passa
-- dela, mas fica sabendo que existe um painel. Com isto, vê 404.
--
-- ⚠️ APARELHO, E NÃO IP. O pedido veio como "liberar o IP dela". IP de casa
-- troca sozinho quase todo dia e no 4G troca a cada hora: o gestor passaria o
-- dia reaprovando gente, e o atendente ficaria trancado no meio do expediente
-- sem entender por quê. O que fica marcado é o NAVEGADOR daquele aparelho, e a
-- marca sobrevive a troca de IP, de Wi-Fi para 4G e de rede do comitê para casa.
--
-- ⚠️ A APROVAÇÃO É NA GERAÇÃO, NÃO DEPOIS. O gestor escolhe a pessoa e recebe
-- um link de uso único com validade; mandar o link É aprovar. A alternativa
-- ("a pessoa pede, o gestor aprova") tem um defeito que anula o objetivo: a
-- tela de "pedido enviado" já conta a quem abriu que existe um painel aqui.
--
-- ⚠️ ISTO É OBSCURIDADE, NÃO SEGURANÇA (CLAUDE.md §7). Quem tiver o cookie e a
-- senha entra. A tranca continua sendo a autenticação e o RLS; esta camada
-- serve para o endereço vazado não revelar nada.

create table if not exists public.aparelhos (
  id          uuid primary key default gen_random_uuid(),
  usuario_id  uuid not null references public.usuarios(id) on delete cascade,
  rotulo      text not null,

  -- ── enquanto é convite ────────────────────────────────────────────────────
  -- O código em claro existe UMA vez, na tela do gestor, no instante em que ele
  -- é gerado. Aqui fica só o hash: um vazamento desta tabela não vira acesso.
  codigo_hash text,
  expira_em   timestamptz,

  -- ── depois de usado ───────────────────────────────────────────────────────
  liberado_em   timestamptz,
  ultimo_uso_em timestamptz,
  revogado_em   timestamptz,
  user_agent    text,

  criado_em timestamptz not null default now(),

  constraint aparelho_rotulo_util check (length(btrim(rotulo)) between 2 and 60)
);

create unique index if not exists aparelhos_codigo_uk
  on public.aparelhos (codigo_hash) where codigo_hash is not null;
create index if not exists aparelhos_usuario_idx on public.aparelhos (usuario_id);

alter table public.aparelhos enable row level security;

drop policy if exists aparelhos_gestor on public.aparelhos;
create policy aparelhos_gestor on public.aparelhos
  for all to authenticated using (public.is_gestor()) with check (public.is_gestor());

-- O atendente vê os PRÓPRIOS aparelhos: é como ele confere de quantos lugares
-- entra, e percebe um que não reconhece.
drop policy if exists aparelhos_proprios on public.aparelhos;
create policy aparelhos_proprios on public.aparelhos
  for select to authenticated using (usuario_id = (select auth.uid()));

-- ── O interruptor ───────────────────────────────────────────────────────────
-- ⚠️ NASCE DESLIGADO, e isso não é timidez. Ligar antes de o gestor liberar o
-- próprio aparelho trancaria ele para fora do painel — inclusive da tela que
-- desliga o interruptor. Desligado por padrão, ele libera o aparelho dele
-- primeiro, confere que entra, e só então liga.
--
-- Se mesmo assim alguém se trancar: este campo é alcançável pelo SQL do
-- Supabase, fora do painel. É a saída de emergência, e está documentada.
alter table public.config
  add column if not exists exigir_aparelho boolean not null default false;

comment on column public.config.exigir_aparelho is
  'Sem aparelho liberado, todo caminho interno devolve 404. Se você se trancar '
  'para fora, desligue por aqui: update public.config set exigir_aparelho = false;';

-- ── Gerar o convite ─────────────────────────────────────────────────────────
create or replace function public.criar_convite_aparelho(
  p_usuario_id uuid,
  p_rotulo     text,
  p_codigo_hash text,
  p_horas      int default 48
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_id uuid;
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'somente_gestor');
  end if;
  if not exists (select 1 from public.usuarios where id = p_usuario_id) then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_nao_existe');
  end if;

  insert into public.aparelhos (usuario_id, rotulo, codigo_hash, expira_em)
  values (p_usuario_id, btrim(p_rotulo), p_codigo_hash,
          now() + make_interval(hours => greatest(coalesce(p_horas, 48), 1)))
  returning id into v_id;

  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

-- ── Usar o convite ──────────────────────────────────────────────────────────
-- Roda para quem AINDA NÃO tem sessão: quem abre o link é a pessoa, antes de
-- entrar. Quem autoriza é o próprio código, que só o gestor teve.
create or replace function public.usar_convite_aparelho(
  p_codigo_hash text,
  p_user_agent  text default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_a public.aparelhos%rowtype;
begin
  select * into v_a from public.aparelhos
   where codigo_hash = p_codigo_hash and revogado_em is null;

  -- Um motivo só para todos os casos: código errado, vencido e já usado
  -- respondem igual. Separar diria a quem está tentando o que mudar na próxima.
  if v_a.id is null or v_a.expira_em < now() then
    return jsonb_build_object('ok', false, 'motivo', 'convite_invalido');
  end if;

  update public.aparelhos
     set codigo_hash   = null,          -- uso único: queima na hora
         liberado_em   = now(),
         ultimo_uso_em = now(),
         user_agent    = left(coalesce(p_user_agent, ''), 300)
   where id = v_a.id;

  return jsonb_build_object('ok', true, 'id', v_a.id, 'usuario_id', v_a.usuario_id);
end;
$$;

-- ── O aparelho ainda vale? ──────────────────────────────────────────────────
create or replace function public.aparelho_ativo(p_id uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
  select exists (
    select 1 from public.aparelhos
     where id = p_id and liberado_em is not null and revogado_em is null
  );
$$;

create or replace function public.revogar_aparelho(p_id uuid)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'somente_gestor');
  end if;
  update public.aparelhos set revogado_em = now() where id = p_id and revogado_em is null;
  return jsonb_build_object('ok', true);
end;
$$;

-- ── O interruptor, legível pelo proxy ───────────────────────────────────────
-- ⚠️ O proxy roda em TODA requisição interna e não tem sessão de gestor. Esta
-- função existe para ele perguntar "a trava está ligada?" sem precisar da chave
-- de serviço no pacote da borda. Devolve um booleano sem contexto nenhum — quem
-- o lê não descobre nada que a existência do endereço já não diga.
create or replace function public.exigir_aparelho()
returns boolean
language sql stable security definer set search_path = ''
as $$
  select coalesce((select exigir_aparelho from public.config where id = 1), false);
$$;

grant execute on function public.exigir_aparelho() to anon, authenticated;
