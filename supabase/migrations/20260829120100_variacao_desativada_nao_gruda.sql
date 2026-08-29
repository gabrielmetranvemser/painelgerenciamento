-- =============================================================================
-- Variação desativada para de grudar no contato que ainda não foi abordado
-- =============================================================================
-- ⚠️ Este é o defeito de "mudei a mensagem e não mudou para os atendentes".
--
-- `preparar_mensagem` congela a variação escolhida na linha de `interacoes` do
-- contato, e nas chamadas seguintes reaproveita aquele id. O congelamento é
-- certo — não pode o texto trocar debaixo do atendente entre o preparo e o
-- envio, nem depois, porque `interacoes` é prova de auditoria do que foi
-- mandado. Só que ele estava valendo cedo demais e sem prazo de validade:
--
--   1. valia mesmo com `aberto_wa_em is null`, ou seja, para uma mensagem que
--      NUNCA saiu — era só rascunho;
--   2. valia mesmo depois de o gestor DESATIVAR aquela variação.
--
-- Resultado observado em 28/08: o contato Paladyo (na fila, nunca abordado)
-- continuava abrindo com o texto da variação 4 da Permissão, desativada pelo
-- gestor no dia anterior, enquanto as duas variações ativas — as que ele estava
-- editando — não apareciam para ninguém que já tivesse passado pela fila.
--
-- A regra nova separa as duas coisas:
--
--   já aberta (`aberto_wa_em` preenchido) → o id fica, sempre. É o que foi
--       enviado de verdade; trocar isso falsificaria o histórico.
--   ainda rascunho → só vale se a variação continuar ativa e ainda pertencer
--       ao modelo daquela etapa. Se não, escolhe de novo entre as ativas e
--       REGRAVA a linha.
--
-- Editar o TEXTO de uma variação ativa nunca dependeu disto: o texto é lido de
-- `variacoes` na hora. O que estava preso era a escolha de QUAL variação.

create or replace function public.preparar_mensagem(
  p_contato_id      uuid,
  p_chip_id         uuid,
  p_etapa           public.etapa_msg,
  p_candidato_id    uuid default null,
  p_modelo_livre_id uuid default null
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
  v_pagina    text;
  v_livre     public.modelos_livres%rowtype;
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

  if v_chip.status in ('pausado', 'morto')
     or (v_chip.pausado_ate is not null and v_chip.pausado_ate > now()) then
    return jsonb_build_object('ok', false, 'motivo', 'chip_indisponivel');
  end if;
  if exists (select 1 from public.dias_bloqueados d where d.data = public.hoje_operacional()) then
    return jsonb_build_object('ok', false, 'motivo', 'dia_bloqueado');
  end if;
  if public.hora_local() < v_cfg.hora_inicio or public.hora_local() >= v_cfg.hora_fim then
    return jsonb_build_object('ok', false, 'motivo', 'fora_de_horario');
  end if;
  if p_etapa <> 'saida'
     and exists (select 1 from public.bloqueios b where b.telefone_hmac = v_contato.telefone_hmac) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_bloqueado');
  end if;
  if v_contato.telefone_e164 is null then
    return jsonb_build_object('ok', false, 'motivo', 'dados_apagados');
  end if;

  -- Sem chapa, a permissão sairia sem dizer de quem é o material.
  if p_etapa = 'permissao'
     and not exists (select 1 from public.chapa_do_atendente(v_uid)) then
    return jsonb_build_object('ok', false, 'motivo', 'sem_chapa');
  end if;

  if public.etapa_por_candidato(p_etapa) then
    if p_candidato_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'candidato_obrigatorio');
    end if;

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
     where m.candidato_id = p_candidato_id and m.ativo
       and (case when p_etapa = 'convite_grupo' then m.tipo = 'canal' else true end);

    v_pagina := public.garantir_link_candidato(p_contato_id, p_candidato_id);
  end if;

  -- ── Mensagem escrita pelo gestor ─────────────────────────────────────────
  -- Caminho próprio: os livres não têm variação nem rotação por chip.
  if p_etapa = 'livre' then
    if p_modelo_livre_id is null then
      return jsonb_build_object('ok', false, 'motivo', 'modelo_obrigatorio');
    end if;

    select * into v_livre
      from public.modelos_livres where id = p_modelo_livre_id and ativo;

    if v_livre.id is null then
      return jsonb_build_object('ok', false, 'motivo', 'modelo_ausente');
    end if;

    insert into public.interacoes
      (contato_id, atendente_id, chip_id, etapa, candidato_id, modelo_livre_id,
       dia_operacional)
    values
      (p_contato_id, v_uid, p_chip_id, 'livre', null, p_modelo_livre_id,
       public.hoje_operacional())
    on conflict (contato_id, etapa, candidato_id, modelo_livre_id) do update
      set atendente_id = case when interacoes.aberto_wa_em is null
                              then excluded.atendente_id else interacoes.atendente_id end,
          chip_id      = case when interacoes.aberto_wa_em is null
                              then excluded.chip_id else interacoes.chip_id end,
          dia_operacional = case when interacoes.aberto_wa_em is null
                                 then excluded.dia_operacional else interacoes.dia_operacional end;

    return jsonb_build_object(
      'ok', true,
      'etapa', 'livre',
      'modelo_livre_id', v_livre.id,
      'variacao_id', null,
      'modelo', v_livre.texto,
      'contato', jsonb_build_object(
        'id', v_contato.id, 'nome', v_contato.nome,
        'primeiro_nome', v_contato.primeiro_nome, 'telefone_e164', v_contato.telefone_e164,
        'origem', v_contato.origem
      ),
      'atendente_nome', v_usuario.primeiro_nome,
      'timezone', v_cfg.timezone,
      'municipio', (select m.nome from public.municipios m where m.id = v_contato.municipio_id),
      'chapa', coalesce((
        select jsonb_agg(jsonb_build_object(
                 'id', ch.candidato_id, 'nome', ch.nome_urna, 'cargo', ch.cargo,
                 'numero', ch.numero, 'partido', ch.partido_sigla, 'principal', ch.principal
               ))
          from public.chapa_do_atendente(v_uid) ch
      ), '[]'::jsonb),
      'candidato', null,
      'materiais', '[]'::jsonb,
      'pagina_token', null
    );
  end if;

  select * into v_modelo from public.modelos where etapa = p_etapa and ativo;
  if v_modelo.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'modelo_ausente');
  end if;

  -- ⚠️ A MUDANÇA. Ver o cabeçalho desta migration.
  --
  -- A variação já escolhida só continua valendo se (a) a mensagem realmente
  -- saiu — e aí ela é histórico, não escolha —, ou (b) ela ainda está ativa e
  -- ainda é deste modelo. Fora isso, é rascunho velho e se escolhe de novo.
  select i.variacao_id into v_escolhida
    from public.interacoes i
    join public.variacoes v on v.id = i.variacao_id
   where i.contato_id = p_contato_id
     and i.etapa = p_etapa
     and i.candidato_id is not distinct from p_candidato_id
     and i.modelo_livre_id is null
     and (i.aberto_wa_em is not null or (v.ativa and v.modelo_id = v_modelo.id));

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
    on conflict (contato_id, etapa, candidato_id, modelo_livre_id) do update
      -- Enquanto é rascunho, a variação nova SUBSTITUI a velha. Era o
      -- `coalesce` daqui que segurava a desativada no lugar.
      set variacao_id = case when interacoes.aberto_wa_em is null
                             then excluded.variacao_id else interacoes.variacao_id end,
          atendente_id = case when interacoes.aberto_wa_em is null
                              then excluded.atendente_id else interacoes.atendente_id end,
          chip_id      = case when interacoes.aberto_wa_em is null
                              then excluded.chip_id else interacoes.chip_id end,
          dia_operacional = case when interacoes.aberto_wa_em is null
                                 then excluded.dia_operacional else interacoes.dia_operacional end
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
      'primeiro_nome', v_contato.primeiro_nome, 'telefone_e164', v_contato.telefone_e164,
      'origem', v_contato.origem
    ),
    'atendente_nome', v_usuario.primeiro_nome,
    'timezone', v_cfg.timezone,
    'municipio', (select m.nome from public.municipios m where m.id = v_contato.municipio_id),
    'chapa', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', ch.candidato_id, 'nome', ch.nome_urna, 'cargo', ch.cargo,
               'numero', ch.numero, 'partido', ch.partido_sigla, 'principal', ch.principal
             ))
        from public.chapa_do_atendente(v_uid) ch
    ), '[]'::jsonb),
    'candidato', case when v_cand.id is null then null else jsonb_build_object(
      'id', v_cand.id, 'nome', v_cand.nome_urna, 'cargo', v_cand.cargo,
      'numero', v_cand.numero, 'partido', v_cand.partido_sigla,
      'cnpj', v_cand.cnpj_campanha
    ) end,
    'materiais', coalesce(v_materiais, '[]'::jsonb),
    'pagina_token', v_pagina
  );
end;
$$;

revoke execute on function public.preparar_mensagem(uuid, uuid, public.etapa_msg, uuid, uuid)
  from anon, public;
grant execute on function public.preparar_mensagem(uuid, uuid, public.etapa_msg, uuid, uuid)
  to authenticated;

-- Limpa o que já ficou preso: rascunho (nunca aberto) apontando para variação
-- desativada volta a ser rascunho sem variação, e o próximo preparo escolhe uma
-- ativa. Não toca em nada que tenha `aberto_wa_em`.
update public.interacoes i
   set variacao_id = null
  from public.variacoes v
 where v.id = i.variacao_id
   and i.aberto_wa_em is null
   and not v.ativa;
