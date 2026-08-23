-- =============================================================================
-- Mensagem e material por candidato
-- =============================================================================

-- ── Uma interação por contato, etapa E candidato ───────────────────────────
-- O material passa a ser uma mensagem POR candidato, então a chave antiga
-- (contato, etapa) não serve mais.
--
-- `nulls not distinct` é o detalhe que faz isso funcionar: sem ele, o Postgres
-- trataria cada NULL como valor diferente e o contato poderia receber DUAS
-- permissões — que é justamente a idempotência que a chave existe para garantir.
alter table public.interacoes
  add column if not exists candidato_id uuid references public.candidatos(id) on delete set null;

alter table public.interacoes drop constraint if exists interacoes_contato_id_etapa_key;

create unique index if not exists interacoes_contato_etapa_candidato_uk
  on public.interacoes (contato_id, etapa, candidato_id) nulls not distinct;

-- ── A chapa de um atendente, na ordem de leitura ───────────────────────────
-- Principal primeiro; depois a ordem em que a pessoa vê na cola de votação.
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
   order by ac.principal desc,
     case c.cargo
       when 'deputado_federal'   then 1
       when 'deputado_estadual'  then 2
       when 'deputado_distrital' then 2
       when 'senador'            then 3
       when 'governador'         then 4
       when 'presidente'         then 5
     end,
     c.vaga;
$$;

-- ── Links passam a apontar para um material ────────────────────────────────
create or replace function public.garantir_link_material(p_contato_id uuid, p_material_id uuid)
returns text
language plpgsql security definer set search_path = ''
as $$
declare v_token text;
begin
  select token into v_token from public.links
   where contato_id = p_contato_id and material_id = p_material_id;
  if v_token is not null then return v_token; end if;

  for _ in 1..5 loop
    begin
      insert into public.links (token, contato_id, material_id)
      values (public.gerar_token(), p_contato_id, p_material_id)
      returning token into v_token;
      return v_token;
    exception when unique_violation then
      select token into v_token from public.links
       where contato_id = p_contato_id and material_id = p_material_id;
      if v_token is not null then return v_token; end if;
    end;
  end loop;
  return null;
end;
$$;

-- ── Preparar a mensagem ────────────────────────────────────────────────────
-- Muda em três pontos:
--   1. a Permissão devolve a CHAPA INTEIRA, para o texto declarar todos os
--      candidatos — a pessoa precisa autorizar sabendo de quem vai receber
--   2. o Material é por candidato, com os materiais dele e links próprios
--   3. o Material só sai para candidato DECLARADO na permissão daquele contato
create or replace function public.preparar_mensagem(
  p_contato_id   uuid,
  p_chip_id      uuid,
  p_etapa        public.etapa_msg,
  p_candidato_id uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := (select auth.uid());
  v_cfg       public.config%rowtype;
  v_contato   public.contatos%rowtype;
  v_chip      public.chips%rowtype;
  v_usuario   public.usuarios%rowtype;
  v_modelo    public.modelos%rowtype;
  v_variacao  public.variacoes%rowtype;
  v_escolhida uuid;
  v_cand      public.candidatos%rowtype;
  v_materiais jsonb;
begin
  select * into v_cfg     from public.config where id = 1;
  select * into v_contato from public.contatos where id = p_contato_id;
  select * into v_chip    from public.chips where id = p_chip_id;
  select * into v_usuario from public.usuarios where id = v_uid;

  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;
  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;

  -- ── Material: exige candidato, e candidato DECLARADO ─────────────────────
  if p_etapa = 'material' then
    if p_candidato_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_obrigatorio');
    end if;

    -- A trava do consentimento. Os registros de contato_candidato nascem quando
    -- a permissão é enviada, congelando o que foi declarado àquela pessoa. Um
    -- candidato acrescentado à chapa depois NÃO alcança quem já autorizou —
    -- precisaria de nova permissão.
    if not exists (
      select 1 from public.contato_candidato cc
       where cc.contato_id = p_contato_id and cc.candidato_id = p_candidato_id
    ) then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_nao_declarado');
    end if;

    select * into v_cand from public.candidatos where id = p_candidato_id and ativo;
    if v_cand.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_inativo');
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
             'titulo', m.titulo, 'tipo', m.tipo,
             'token', public.garantir_link_material(p_contato_id, m.id)
           ) order by m.ordem, m.titulo), '[]'::jsonb)
      into v_materiais
      from public.materiais m
     where m.candidato_id = p_candidato_id and m.ativo;
  end if;

  select * into v_modelo from public.modelos where etapa = p_etapa and ativo;
  if v_modelo.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_ausente');
  end if;

  -- Variação já escolhida para este contato+etapa+candidato? Reaproveita, para
  -- recarregar a tela não trocar o texto embaixo do atendente.
  select i.variacao_id into v_escolhida
    from public.interacoes i
   where i.contato_id = p_contato_id and i.etapa = p_etapa
     and i.candidato_id is not distinct from p_candidato_id;

  if v_escolhida is null then
    v_escolhida := public.proxima_variacao(
      v_modelo.id,
      (select r.ultima_variacao_id from public.rotacao_chip r
        where r.chip_id = p_chip_id and r.modelo_id = v_modelo.id)
    );
    if v_escolhida is null then
      return jsonb_build_object('ok', false, 'motivo', 'sem_variacao');
    end if;

    insert into public.rotacao_chip (chip_id, modelo_id, ultima_variacao_id)
    values (p_chip_id, v_modelo.id, v_escolhida)
    on conflict (chip_id, modelo_id)
      do update set ultima_variacao_id = excluded.ultima_variacao_id, atualizado_em = now();

    insert into public.interacoes
      (contato_id, atendente_id, chip_id, etapa, candidato_id, variacao_id, dia_operacional)
    values
      (p_contato_id, v_uid, p_chip_id, p_etapa, p_candidato_id, v_escolhida, public.hoje_operacional())
    on conflict (contato_id, etapa, candidato_id) do update
      set variacao_id = coalesce(interacoes.variacao_id, excluded.variacao_id)
    returning variacao_id into v_escolhida;
  end if;

  select * into v_variacao from public.variacoes where id = v_escolhida;

  return jsonb_build_object(
    'ok', true,
    'etapa', p_etapa,
    'variacao_id', v_variacao.id,
    'modelo', v_variacao.texto,
    'contato', jsonb_build_object(
      'id', v_contato.id, 'nome', v_contato.nome,
      'primeiro_nome', v_contato.primeiro_nome, 'telefone_e164', v_contato.telefone_e164
    ),
    'atendente_nome', v_usuario.primeiro_nome,
    'timezone', v_cfg.timezone,
    'municipio', (select m.nome from public.municipios m where m.id = v_contato.municipio_id),

    -- A chapa inteira: é o que a Permissão declara.
    'chapa', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ch.candidato_id, 'nome', ch.nome_urna, 'cargo', ch.cargo,
               'numero', ch.numero, 'partido', ch.partido_sigla, 'principal', ch.principal
             ))
        from public.chapa_do_atendente(v_uid) ch
    ), '[]'::jsonb),

    -- O candidato desta mensagem, quando ela é de um só.
    'candidato', case when v_cand.id is null then null else jsonb_build_object(
      'id', v_cand.id, 'nome', v_cand.nome_urna, 'cargo', v_cand.cargo,
      'numero', v_cand.numero, 'partido', v_cand.partido_sigla,
      'cnpj', v_cand.cnpj_campanha
    ) end,
    'materiais', coalesce(v_materiais, '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.preparar_mensagem(uuid, uuid, public.etapa_msg, uuid) from anon, public;
revoke execute on function public.garantir_link_material(uuid, uuid) from anon, public, authenticated;
revoke execute on function public.chapa_do_atendente(uuid) from anon, public;
grant  execute on function public.preparar_mensagem(uuid, uuid, public.etapa_msg, uuid) to authenticated;
grant  execute on function public.chapa_do_atendente(uuid) to authenticated;

-- A assinatura antiga sai de circulação para nenhuma chamada esquecida usar o
-- caminho de um candidato só.
drop function if exists public.preparar_mensagem(uuid, uuid, public.etapa_msg);
