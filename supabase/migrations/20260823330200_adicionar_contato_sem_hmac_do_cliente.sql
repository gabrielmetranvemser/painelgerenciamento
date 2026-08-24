-- =============================================================================
-- `adicionar_contato` deixa de aceitar o HMAC que o navegador mandar
-- =============================================================================
-- ⚠️ Bypass completo da lista de bloqueio e do dedup, na mão de qualquer
--    atendente com o DevTools aberto.
--
-- A função tinha `grant execute ... to authenticated`, então era chamável direto
-- do navegador com a sessão do atendente. E recebia `p_telefone_hmac` e
-- `p_chave_dedup` PRONTOS, sem conferir que batiam com `p_telefone_e164`.
--
-- Bastava mandar um hash qualquer:
--
--   • a checagem `exists (... where telefone_hmac = p_telefone_hmac)` não achava
--     nada, e o número de quem pediu saída entrava na fila como contato novo —
--     envio depois do pedido de saída é multa POR MENSAGEM;
--   • o UNIQUE de `chave_dedup` também não pegava, então dava para criar um
--     segundo registro de um número que já é de outro atendente — dois
--     atendentes falando com a mesma pessoa, que é o caminho da denúncia.
--
-- Isso contrariava o princípio do projeto: "toda trava é validada no SERVIDOR".
-- O HMAC vinha do servidor Node, sim, mas nada obrigava a chamada a vir de lá.
--
-- Correção em duas camadas:
--
--   1. A função sai do alcance do navegador. Só `service_role` executa, e quem
--      chama é a Server Action, que resolve o atendente pela sessão. Por isso o
--      `p_atendente_id` explícito: sob service_role, `auth.uid()` é nulo.
--   2. Defesa em profundidade: chave de 10 dígitos, e164 no formato brasileiro
--      e os dois coerentes entre si. Um HMAC forjado ainda seria aceito por esta
--      função — o que impede isso é a camada 1 —, mas um payload incoerente
--      passa a morrer aqui também.

-- A assinatura antiga sai de circulação: manter as duas deixaria a chamada por
-- nome de argumento ambígua e o PostgREST recusaria as duas.
drop function if exists public.adicionar_contato(text, text, text, text, int, uuid, smallint, uuid);

create or replace function public.adicionar_contato(
  p_atendente_id  uuid,
  p_nome          text,
  p_primeiro_nome text,
  p_telefone_e164 text,
  p_chave_dedup   text,
  p_telefone_hmac text,
  p_hmac_versao   int,
  p_chip_id       uuid,
  p_municipio_id  smallint default null,
  p_candidato_id  uuid     default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid       uuid := p_atendente_id;
  v_cfg       public.config%rowtype;
  v_usuario   public.usuarios%rowtype;
  v_chip      public.chips%rowtype;
  v_existente public.contatos%rowtype;
  v_dono      text;
  v_contato   public.contatos%rowtype;
  v_nome      text := nullif(btrim(coalesce(p_nome, '')), '');
  -- Vem pronto do Node, de `primeiroNomeDe`. Antes daqui saía
  -- `split_part(nome, ' ', 1)`, que transformava "JOSE DA SILVA" em "JOSE" e
  -- "Sr. Antonio" em "Sr." — e a mensagem saía "Bom dia, JOSE!", denunciando
  -- lista, que é exatamente o que aquela função existe para evitar.
  v_primeiro  text := nullif(btrim(coalesce(p_primeiro_nome, '')), '');
begin
  if v_uid is null then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inativo');
  end if;

  select * into v_cfg from public.config where id = 1;
  select * into v_usuario from public.usuarios where id = v_uid;
  select * into v_chip from public.chips where id = p_chip_id;

  -- ── As travas que valem para cadastrar ────────────────────────────────────
  if v_usuario.id is null or not v_usuario.ativo then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inativo');
  end if;

  -- Mesma porta da fila: sem termo aceito não se atende ninguém.
  if v_usuario.termo_aceito_em is null then
    return jsonb_build_object('ok', false, 'motivo', 'termo_nao_aceito');
  end if;

  if v_chip.id is null or v_chip.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;

  if v_chip.status in ('pausado', 'morto')
     or (v_chip.pausado_ate is not null and v_chip.pausado_ate > now()) then
    return jsonb_build_object('ok', false, 'motivo', 'chip_indisponivel');
  end if;

  -- ── Coerência do telefone ─────────────────────────────────────────────────
  -- `chave_dedup` é DDD + os 8 dígitos finais; `e164` é 55 + DDD + (9) + 8.
  -- Os dois têm de terminar nos MESMOS 8 dígitos e começar no MESMO DDD, senão
  -- o dedup do banco estaria protegendo um número diferente do que vai ser
  -- chamado no WhatsApp.
  if p_telefone_e164 is null or p_telefone_hmac is null or p_chave_dedup is null then
    return jsonb_build_object('ok', false, 'motivo', 'telefone_invalido');
  end if;
  if p_chave_dedup !~ '^[0-9]{10}$' or p_telefone_e164 !~ '^55[0-9]{10,11}$' then
    return jsonb_build_object('ok', false, 'motivo', 'telefone_invalido');
  end if;
  if right(p_telefone_e164, 8) <> right(p_chave_dedup, 8)
     or substr(p_telefone_e164, 3, 2) <> left(p_chave_dedup, 2) then
    return jsonb_build_object('ok', false, 'motivo', 'telefone_invalido');
  end if;

  -- ── Pediu saída antes ─────────────────────────────────────────────────────
  -- Recusa, sempre. A única prova aqui seria a palavra do atendente, e desfazer
  -- um pedido de saída com base nisso é exatamente o que gera multa por
  -- mensagem. Fica para o gestor, na tela de Suporte.
  if exists (select 1 from public.bloqueios b where b.telefone_hmac = p_telefone_hmac) then
    insert into public.alertas (tipo, atendente_id, detalhe)
    values ('cadastro_de_bloqueado_recusado', v_uid,
            'Um atendente tentou cadastrar um número que está na lista de bloqueio. ' ||
            'Se a pessoa realmente voltou a procurar a campanha, só o gestor pode liberar.');
    return jsonb_build_object('ok', false, 'motivo', 'numero_bloqueado');
  end if;

  -- ── Já conhecemos esse número? ────────────────────────────────────────────
  select * into v_existente
    from public.contatos c
   where c.telefone_hmac = p_telefone_hmac
   for update;

  if found then
    -- Já é dele: não duplica, só devolve.
    if v_existente.atendente_id = v_uid then
      update public.contatos
         set nome            = coalesce(v_nome, nome),
             primeiro_nome   = coalesce(v_primeiro, primeiro_nome),
             municipio_id    = coalesce(p_municipio_id, municipio_id),
             status          = case when status in ('na_fila', 'sem_resposta')
                                    then 'em_atendimento' else status end,
             chip_id         = p_chip_id,
             claimed_at      = case when status in ('na_fila', 'sem_resposta')
                                    then now() else claimed_at end,
             claim_expira_em = now() + make_interval(mins => v_cfg.lease_minutos)
       where id = v_existente.id
       returning * into v_contato;

      return jsonb_build_object(
        'ok', true, 'ja_existia', true, 'era_de_outro', false,
        'contato', public.contato_json(v_contato)
      );
    end if;

    -- É de outro atendente. Não se tira contato de ninguém por um botão.
    if v_existente.atendente_id is not null then
      select u.primeiro_nome into v_dono
        from public.usuarios u where u.id = v_existente.atendente_id;
      return jsonb_build_object(
        'ok', false, 'motivo', 'ja_e_de_outro_atendente',
        'atendente', coalesce(v_dono, 'outro atendente')
      );
    end if;

    -- Está na base sem dono. Passa a ser dele: quem recebeu a mensagem é quem
    -- responde.
    update public.contatos
       set nome            = coalesce(v_nome, nome),
           primeiro_nome   = coalesce(v_primeiro, primeiro_nome),
           telefone_e164   = p_telefone_e164,
           chave_dedup     = p_chave_dedup,
           municipio_id    = coalesce(p_municipio_id, municipio_id),
           anonimizado_em  = null,
           -- A origem só vira 'chamou' se o número NÃO veio de uma lista: a
           -- frase de {{origem}} é a divulgação de como obtivemos o número, e
           -- nós já o tínhamos.
           origem          = case when lista_id is null then 'chamou'::public.origem_contato
                                  else origem end,
           candidato_origem_id = coalesce(p_candidato_id, candidato_origem_id),
           status          = 'em_atendimento',
           atendente_id    = v_uid,
           chip_id         = p_chip_id,
           claimed_at      = now(),
           claim_expira_em = now() + make_interval(mins => v_cfg.lease_minutos),
           resultado_em    = null
     where id = v_existente.id
     returning * into v_contato;

    return jsonb_build_object(
      'ok', true, 'ja_existia', true, 'era_de_outro', false,
      'contato', public.contato_json(v_contato)
    );
  end if;

  -- ── Contato novo ──────────────────────────────────────────────────────────
  insert into public.contatos
    (origem, nome, primeiro_nome, telefone_e164, chave_dedup,
     telefone_hmac, hmac_versao, municipio_id, candidato_origem_id,
     status, atendente_id, chip_id, claimed_at, claim_expira_em)
  values
    ('chamou', v_nome, v_primeiro, p_telefone_e164, p_chave_dedup,
     p_telefone_hmac, p_hmac_versao, p_municipio_id, p_candidato_id,
     'em_atendimento', v_uid, p_chip_id, now(),
     now() + make_interval(mins => v_cfg.lease_minutos))
  returning * into v_contato;

  -- A pessoa escreveu para ESTE atendente sobre ESTA candidatura.
  if p_candidato_id is not null then
    insert into public.contato_candidato (contato_id, candidato_id)
    values (v_contato.id, p_candidato_id)
    on conflict (contato_id, candidato_id) do nothing;
  end if;

  return jsonb_build_object(
    'ok', true, 'ja_existia', false, 'era_de_outro', false,
    'contato', public.contato_json(v_contato)
  );

exception
  when unique_violation then
    return jsonb_build_object('ok', false, 'motivo', 'numero_repetido');
end;
$$;

-- ⚠️ NÃO conceder a `authenticated`. Foi exatamente isso que abriu o buraco:
-- função que aceita identificador de telefone pronto não pode ser chamável por
-- quem tem interesse em forjar esse identificador.
revoke execute on function public.adicionar_contato(uuid, text, text, text, text, text, int, uuid, smallint, uuid)
  from anon, public, authenticated;
grant  execute on function public.adicionar_contato(uuid, text, text, text, text, text, int, uuid, smallint, uuid)
  to service_role;
