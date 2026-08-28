-- =============================================================================
-- Escolher qual contato atender
-- =============================================================================
-- Até aqui só existia "Buscar próximo contato": a fila decidia, e o atendente
-- não tinha como dizer "quero falar com aquele". Nos testes isso apareceu de
-- duas formas — o atendente que combinou de ligar para alguém num horário, e o
-- que quer varrer uma vizinhança na ordem dele.
--
-- ⚠️ AS TRAVAS SÃO EXATAMENTE AS MESMAS. Escolher muda O CRITÉRIO, não a
-- permissão: teto do dia, janela de horário, intervalo entre abordagens, dia
-- bloqueado, lista que é sua, chip que é seu, bloqueio de quem pediu saída e a
-- chapa continuam valendo, e continuam sendo conferidos aqui dentro. Um
-- caminho alternativo que afrouxa uma trava é a forma clássica de a trava
-- deixar de existir.
--
-- E o `for update skip locked` é o mesmo: dois atendentes clicando no mesmo
-- contato ao mesmo tempo, um leva.

/**
 * A fila deste atendente, para ele escolher de quem falar.
 *
 * ⚠️ NÃO DEVOLVE O TELEFONE. A tela de escolha é uma lista de gente que ninguém
 * abordou ainda; mandar o número de cada um para o navegador seria exportar
 * pedaço da base a cada abertura de tela, e o atendente não precisa dele para
 * escolher — ele recebe o número quando pega o contato.
 *
 * Usa o MESMO critério de `pegar_proximo_contato` (via `status_entregavel` e os
 * mesmos filtros): contador ou cardápio que promete contato que a fila não
 * entrega é o defeito clássico daqui.
 */
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

  -- A lista escolhida chega do navegador e só vale se for mesmo deste
  -- atendente e estiver ativa — a mesma conferência de `fila_status`.
  if p_lista_id is not null and not exists (
    select 1 from public.atendente_listas al
     join public.listas l on l.id = al.lista_id
    where al.atendente_id = v_uid and al.lista_id = p_lista_id and l.ativa
  ) then
    return jsonb_build_object('erro', 'lista_nao_e_sua');
  end if;

  select coalesce(jsonb_agg(x order by x.ordem), '[]'::jsonb) into v_r
    from (
      select jsonb_build_object(
               'id', c.id,
               'nome', coalesce(c.primeiro_nome, c.nome),
               'origem', c.origem,
               'municipio', (select m.nome from public.municipios m where m.id = c.municipio_id),
               'lista_id', c.lista_id,
               'lista', (select l.rotulo from public.listas l where l.id = c.lista_id),
               'criado_em', c.criado_em,
               -- Reagendado por ele mesmo: é a agenda, e vem marcada.
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
         -- Busca só por NOME. Procurar por telefone aqui seria transformar a
         -- tela num consultador de números, que é o que `consultar_telefone`
         -- faz — com trava própria e devolvendo o mínimo.
         and (v_busca is null or c.nome ilike '%' || v_busca || '%')
       order by ordem
       limit p_limite
    ) t;

  return jsonb_build_object('ok', true, 'linhas', v_r);
end;
$$;

revoke execute on function public.fila_do_atendente(uuid, text, int) from anon, public;
grant  execute on function public.fila_do_atendente(uuid, text, int) to authenticated;

/**
 * Pega UM contato específico da fila.
 *
 * O corpo é `pegar_proximo_contato` com um `where` a mais. Vem duplicado porque
 * é assim que se escreve função no Postgres — e as duas precisam mudar juntas.
 *
 * ⚠️ Nada aqui afrouxa nada: o contato pedido passa pelos MESMOS filtros da
 * fila (lista que é sua, bloqueio, candidato de origem, adiamento) e por
 * `fila_status`, que é quem sabe de teto, horário, intervalo e chapa. Pedir um
 * id que não passa nos filtros devolve `contato_indisponivel` — nunca o
 * contato.
 */
create or replace function public.pegar_contato_especifico(
  p_contato_id uuid,
  p_chip_id    uuid
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_cfg     public.config%rowtype;
  v_status  jsonb;
  v_contato public.contatos%rowtype;
  v_id      uuid;
begin
  select * into v_cfg from public.config where id = 1;

  -- Contato já na mão volta inteiro, sem passar por filtro nenhum — a mesma
  -- trava de `pegar_proximo_contato`, e pelo mesmo motivo: quem já foi abordado
  -- merece o fim da conversa. Escolher outro no meio de um atendimento não
  -- larga o que está na tela.
  select * into v_contato
    from public.contatos c
   where c.atendente_id = v_uid
     and c.status = 'em_atendimento'
     and c.claim_expira_em > now()
   order by c.claimed_at
   limit 1;

  if found then
    return jsonb_build_object(
      'ok', true, 'retomada', true,
      'contato', public.contato_json(v_contato),
      'fila', public.fila_status(p_chip_id)
    );
  end if;

  v_status := public.fila_status(p_chip_id);
  if not (v_status->>'pode')::boolean then
    return jsonb_build_object('ok', false, 'motivo', v_status->>'motivo', 'fila', v_status);
  end if;

  select c.id into v_id
    from public.contatos c
   where c.id = p_contato_id
     and public.status_entregavel(c.status, c.atendente_id, v_uid)
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
   for update skip locked;

  -- Um motivo só para "não existe", "não é sua lista", "alguém pegou primeiro"
  -- e "está bloqueado": a tela não deve virar um oráculo que diz o que existe
  -- na base fora do alcance de quem pergunta.
  if v_id is null then
    return jsonb_build_object('ok', false, 'motivo', 'contato_indisponivel', 'fila', v_status);
  end if;

  update public.contatos
     set status='em_atendimento', atendente_id=v_uid, chip_id=p_chip_id,
         claimed_at=now(), adiado_ate = null,
         claim_expira_em = now() + make_interval(mins => v_cfg.lease_minutos)
   where id = v_id
   returning * into v_contato;

  return jsonb_build_object(
    'ok', true, 'retomada', false,
    'contato', public.contato_json(v_contato),
    'fila', public.fila_status(p_chip_id)
  );
end;
$$;

revoke execute on function public.pegar_contato_especifico(uuid, uuid) from anon, public;
grant  execute on function public.pegar_contato_especifico(uuid, uuid) to authenticated;
