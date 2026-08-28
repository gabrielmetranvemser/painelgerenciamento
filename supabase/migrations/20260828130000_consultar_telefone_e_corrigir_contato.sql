-- =============================================================================
-- Saber ANTES: esse número já é de alguém? — e poder corrigir nome e telefone
-- =============================================================================
-- Dois pedidos dos testes que são o mesmo problema visto de dois lados.
--
-- 1. O atendente cadastra alguém que o chamou, preenche tudo, clica — e SÓ
--    ENTÃO descobre que o número já está com um colega. `adicionar_contato` já
--    recusava com `ja_e_de_outro_atendente`, mas depois do trabalho feito, e
--    sem dizer o que fazer. Pior: quando duas pessoas atendem o mesmo número,
--    quem leva a denúncia é a campanha.
--
-- 2. O nome vem errado da planilha, ou a pessoa diz "esse número é do meu
--    filho, o meu é outro". Não havia como corrigir NADA: nem nome, nem
--    telefone. O atendente convivia com "Bom dia, MARIA DAS D SILVA!".

-- ── 1. Consulta antes de cadastrar ──────────────────────────────────────────
/**
 * Esse número já existe na base? De quem é? Já foi falado?
 *
 * ⚠️ ISTO É UMA PORTA DE CONSULTA DE TELEFONE ARBITRÁRIO, e foi desenhada
 * sabendo disso:
 *
 *   • recebe o HMAC, não o número. Quem chama precisa do segredo do servidor
 *     para calcular o identificador — o navegador não consegue.
 *   • devolve o MÍNIMO: existe, em que pé está, e o PRIMEIRO NOME de quem
 *     atende. Nunca o cadastro, nunca o telefone, nunca o nome do contato.
 *   • só atendente ativo com termo aceito.
 *
 * O primeiro nome do colega sai porque é a informação que resolve o caso: o
 * atendente precisa saber com QUEM falar antes de responder à pessoa. Sem isso
 * o aviso viraria "esse número é de outra pessoa, se vira".
 */
create or replace function public.consultar_telefone(p_telefone_hmac text)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_usuario public.usuarios%rowtype;
  v_contato public.contatos%rowtype;
  v_dono    text;
begin
  select * into v_usuario from public.usuarios where id = v_uid;
  if v_usuario.id is null or not v_usuario.ativo then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inativo');
  end if;
  if v_usuario.termo_aceito_em is null then
    return jsonb_build_object('ok', false, 'motivo', 'termo_nao_aceito');
  end if;

  -- Bloqueado vem antes de tudo: é a resposta que muda o que a pessoa pode
  -- fazer, e vale mesmo que o contato já tenha sido apagado.
  if exists (select 1 from public.bloqueios b where b.telefone_hmac = p_telefone_hmac) then
    return jsonb_build_object('ok', true, 'existe', true, 'bloqueado', true);
  end if;

  select * into v_contato
    from public.contatos c
   where c.telefone_hmac = p_telefone_hmac
   limit 1;

  if v_contato.id is null then
    return jsonb_build_object('ok', true, 'existe', false, 'bloqueado', false);
  end if;

  select u.primeiro_nome into v_dono
    from public.usuarios u where u.id = v_contato.atendente_id;

  return jsonb_build_object(
    'ok', true,
    'existe', true,
    'bloqueado', false,
    'status', v_contato.status,
    'meu', v_contato.atendente_id = v_uid,
    -- Nome do ATENDENTE, não do contato. Ver o cabeçalho.
    'atendente', v_dono,
    'ja_falado', v_contato.primeiro_contato_em is not null,
    'primeiro_contato_em', v_contato.primeiro_contato_em
  );
end;
$$;

revoke execute on function public.consultar_telefone(text) from anon, public;
grant  execute on function public.consultar_telefone(text) to authenticated;

-- ── 2. Corrigir nome e telefone, com rastro ─────────────────────────────────
/**
 * O que foi corrigido num contato, por quem e quando.
 *
 * ⚠️ Existe porque telefone é a IDENTIDADE da pessoa no sistema: `chave_dedup`
 * tem índice único, o HMAC é o que liga a lista de bloqueio, e trocar o número
 * de um contato é, na prática, dizer "esta ficha agora é de outra pessoa".
 * Sem rastro, ninguém consegue olhar para trás e entender por que a conversa
 * de ontem está num número que não é o de hoje.
 *
 * Só `insert`, e só por RPC. Trilha que o interessado edita não é trilha.
 */
create table if not exists public.contato_correcoes (
  id         bigint generated always as identity primary key,
  contato_id uuid not null references public.contatos(id) on delete cascade,
  autor_id   uuid references public.usuarios(id),
  campo      text not null check (campo in ('nome', 'telefone')),
  de         text,
  para       text,
  criado_em  timestamptz not null default now()
);

create index if not exists contato_correcoes_contato_idx
  on public.contato_correcoes (contato_id, criado_em desc);

alter table public.contato_correcoes enable row level security;

-- Leitura: o dono do contato ou o gestor. Escrita: só pela RPC.
create policy correcoes_leitura on public.contato_correcoes
  for select to authenticated
  using (
    public.is_gestor()
    or exists (
      select 1 from public.contatos c
       where c.id = contato_correcoes.contato_id
         and c.atendente_id = (select auth.uid())
    )
  );

/**
 * Corrige o nome e/ou o telefone de um contato.
 *
 * `p_telefone_e164`, `p_chave_dedup` e `p_telefone_hmac` chegam JÁ CALCULADOS
 * do servidor de aplicação — o HMAC depende de um segredo que não está no
 * Postgres e não pode chegar ao navegador. É o mesmo caminho de
 * `adicionar_contato`, e pelo mesmo motivo: identificador de telefone que o
 * servidor calcula não pode entrar por uma porta que o navegador alcança.
 *
 * Por isso `p_autor_id` é explícito: sob `service_role`, `auth.uid()` é nulo
 * aqui dentro, e quem resolve quem é o autor é a camada de aplicação, pela
 * sessão — nunca pelo que o formulário mandar.
 */
create or replace function public.corrigir_contato(
  p_autor_id      uuid,
  p_contato_id    uuid,
  p_nome          text default null,
  p_primeiro_nome text default null,
  p_telefone_e164 text default null,
  p_chave_dedup   text default null,
  p_telefone_hmac text default null,
  p_hmac_versao   int  default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_autor   public.usuarios%rowtype;
  v_contato public.contatos%rowtype;
  v_outro   uuid;
  v_mudou   boolean := false;
begin
  select * into v_autor from public.usuarios where id = p_autor_id;
  if v_autor.id is null or not v_autor.ativo then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inativo');
  end if;

  select * into v_contato from public.contatos where id = p_contato_id for update;
  if v_contato.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_encontrado');
  end if;

  -- Dono ou gestor. Corrigir a ficha de um contato alheio é reescrever o
  -- trabalho de outra pessoa.
  if v_contato.atendente_id <> p_autor_id and v_autor.papel <> 'gestor' then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;

  if v_contato.anonimizado_em is not null then
    return jsonb_build_object('ok', false, 'motivo', 'dados_ja_apagados');
  end if;

  -- ── Nome ────────────────────────────────────────────────────────────────
  if p_nome is not null and p_nome is distinct from v_contato.nome then
    insert into public.contato_correcoes (contato_id, autor_id, campo, de, para)
    values (p_contato_id, p_autor_id, 'nome', v_contato.nome, p_nome);

    update public.contatos
       set nome = p_nome, primeiro_nome = coalesce(p_primeiro_nome, primeiro_nome)
     where id = p_contato_id;
    v_mudou := true;
  end if;

  -- ── Telefone ────────────────────────────────────────────────────────────
  if p_telefone_e164 is not null
     and p_telefone_e164 is distinct from v_contato.telefone_e164 then

    -- O número novo não pode estar bloqueado: seria trazer de volta, por uma
    -- porta lateral, quem pediu para sair.
    if exists (select 1 from public.bloqueios b where b.telefone_hmac = p_telefone_hmac) then
      return jsonb_build_object('ok', false, 'motivo', 'numero_bloqueado');
    end if;

    -- Nem pode ser de outra ficha: `chave_dedup` é única, e o `insert` falharia
    -- com erro do Postgres. Melhor dizer de quem é.
    select c.id into v_outro
      from public.contatos c
     where c.chave_dedup = p_chave_dedup and c.id <> p_contato_id
     limit 1;

    if v_outro is not null then
      return jsonb_build_object(
        'ok', false, 'motivo', 'numero_ja_existe',
        'atendente', (select u.primeiro_nome from public.usuarios u
                        join public.contatos c2 on c2.atendente_id = u.id
                       where c2.id = v_outro)
      );
    end if;

    insert into public.contato_correcoes (contato_id, autor_id, campo, de, para)
    values (p_contato_id, p_autor_id, 'telefone', v_contato.telefone_e164, p_telefone_e164);

    update public.contatos
       set telefone_e164 = p_telefone_e164,
           chave_dedup   = p_chave_dedup,
           telefone_hmac = p_telefone_hmac,
           hmac_versao   = coalesce(p_hmac_versao, hmac_versao)
     where id = p_contato_id;
    v_mudou := true;
  end if;

  return jsonb_build_object('ok', true, 'mudou', v_mudou);
end;
$$;

-- Só a aplicação chama, com a chave de serviço (o HMAC vem de lá).
revoke execute on function public.corrigir_contato(uuid, uuid, text, text, text, text, text, int)
  from anon, public, authenticated;

/** O histórico de correções de um contato, para a tela do atendente. */
create or replace function public.correcoes_do_contato(p_contato_id uuid)
returns table (campo text, de text, para text, autor text, criado_em timestamptz)
language sql stable security definer set search_path = ''
as $$
  select cc.campo, cc.de, cc.para, u.primeiro_nome, cc.criado_em
    from public.contato_correcoes cc
    left join public.usuarios u on u.id = cc.autor_id
   where cc.contato_id = p_contato_id
     and (
       public.is_gestor()
       or exists (
         select 1 from public.contatos c
          where c.id = p_contato_id and c.atendente_id = (select auth.uid())
       )
     )
   order by cc.criado_em desc;
$$;

revoke execute on function public.correcoes_do_contato(uuid) from anon, public;
grant  execute on function public.correcoes_do_contato(uuid) to authenticated;
