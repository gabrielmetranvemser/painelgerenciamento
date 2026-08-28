-- =============================================================================
-- Consertar a lista de "Escolher contato" — e mostrar o telefone nela
-- =============================================================================
-- DOIS PROBLEMAS, um deles meu e grave.
--
-- 1. `fila_do_atendente` NUNCA FUNCIONOU. O agregado dizia
--
--      jsonb_agg(x order by x.ordem)
--
--    onde `x` é a COLUNA jsonb da subconsulta, não a tabela. O Postgres tenta
--    resolver `x` como nome de tabela e devolve
--
--      ERROR: missing FROM-clause entry for table "x"
--
--    O certo é `t.ordem` — `t` é o apelido da subconsulta.
--
--    A função foi para produção sem nenhum teste que a chamasse: a leva de
--    testes daquele dia cobriu a chapa e os cadastros, e deixou esta de fora.
--    O sintoma na tela foi "carregando…" para sempre, o que fez parecer lentidão
--    com a base grande — e não era: quebrava com três contatos ou com trinta mil.
--    Os testes em `19_escolher_contato.sql` fecham o buraco.
--
-- 2. O TELEFONE PASSA A APARECER, a pedido de quem opera.
--
--    Ele tinha sido deixado de fora de propósito: a tela lista gente que ainda
--    não foi abordada, e mandar o número de cada um para o navegador é exportar
--    pedaço da base a cada abertura. A ponderação mudou porque, na prática, o
--    atendente reconhece por número o contato que ele mesmo combinou de
--    retomar — e o número já chega a ele de qualquer forma no clique seguinte.
--
--    O que continua valendo: teto de 40 linhas por consulta, e a busca só por
--    NOME. Buscar por telefone aqui transformaria a tela num consultador de
--    números — isso existe em `consultar_telefone`, com trava própria e
--    devolvendo o mínimo.

create or replace function public.fila_do_atendente(
  p_lista_id   uuid default null,
  p_busca      text default null,
  p_limite     int  default 40
)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_busca   text;
  v_r       jsonb;
begin
  if v_uid is null then
    return jsonb_build_object('erro', 'sem_sessao');
  end if;

  p_limite := least(greatest(coalesce(p_limite, 40), 1), 100);
  v_busca  := nullif(btrim(coalesce(p_busca, '')), '');

  if p_lista_id is not null and not exists (
    select 1 from public.atendente_listas al
     join public.listas l on l.id = al.lista_id
    where al.atendente_id = v_uid and al.lista_id = p_lista_id and l.ativa
  ) then
    return jsonb_build_object('erro', 'lista_nao_e_sua');
  end if;

  -- ⚠️ `t.ordem`, e não `x.ordem`: `x` é a coluna jsonb, `t` é a subconsulta.
  -- Ver o cabeçalho — este erro derrubou a tela inteira.
  select coalesce(jsonb_agg(t.x order by t.ordem), '[]'::jsonb) into v_r
    from (
      select jsonb_build_object(
               'id', c.id,
               'nome', coalesce(c.primeiro_nome, c.nome),
               'telefone_e164', c.telefone_e164,
               'origem', c.origem,
               'municipio', (select m.nome from public.municipios m where m.id = c.municipio_id),
               'lista_id', c.lista_id,
               'lista', (select l.rotulo from public.listas l where l.id = c.lista_id),
               'criado_em', c.criado_em,
               'reagendado', c.status = 'falar_depois'
             ) as x,
             row_number() over (
               order by (c.status = 'falar_depois') desc,
                        (c.atendente_id = v_uid) desc nulls last,
                        (c.origem = 'lista_fria'),
                        c.criado_em
             ) as ordem
        from public.contatos c
       where public.status_entregavel(c.status, c.atendente_id, v_uid)
         and c.telefone_e164 is not null
         and (c.atendente_id is null or c.atendente_id = v_uid)
         and (c.adiado_ate is null or c.adiado_ate <= now())
         and not exists (select 1 from public.bloqueios b where b.telefone_hmac = c.telefone_hmac)
         and (
           c.candidato_origem_id is null
           or exists (
             select 1 from public.atendente_candidatos ac
              where ac.atendente_id = v_uid and ac.candidato_id = c.candidato_origem_id
           )
         )
         and (
           c.lista_id is null
           or exists (
             select 1
               from public.atendente_listas al
               join public.listas l on l.id = al.lista_id
              where al.atendente_id = v_uid
                and al.lista_id = c.lista_id
                and l.ativa
           )
         )
         and (p_lista_id is null or c.lista_id = p_lista_id)
         -- Busca só por NOME. Ver o cabeçalho.
         and (v_busca is null or c.nome ilike '%' || v_busca || '%')
       order by ordem
       limit p_limite
    ) t;

  return jsonb_build_object('ok', true, 'linhas', v_r);
end;
$$;
