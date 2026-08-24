-- =============================================================================
-- O atendente cadastra quem chamou ele
-- =============================================================================
-- Função `security definer` porque o atendente NÃO tem INSERT em `contatos`
-- pelo RLS — e não pode ter: com escrita direta ele se auto-atribuiria a base
-- inteira. Toda regra de quem-fica-com-quem mora aqui dentro.
--
-- O HMAC do telefone chega PRONTO, calculado no servidor Node. A chave secreta
-- não está no Postgres e não vai estar: é o mesmo caminho que a importação usa.
--
-- O que esta função NÃO checa, de propósito: horário, teto do dia, intervalo e
-- dia bloqueado. Essas travas são de ENVIO e continuam onde sempre estiveram,
-- em `registrar_abertura`. Cadastrar às 22h quem te escreveu às 22h é correto;
-- o que o painel não vai deixar é mandar mensagem antes da hora.

create or replace function public.adicionar_contato(
  p_nome          text,
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
  v_uid      uuid := (select auth.uid());
  v_cfg      public.config%rowtype;
  v_usuario  public.usuarios%rowtype;
  v_chip     public.chips%rowtype;
  v_existente public.contatos%rowtype;
  v_dono     text;
  v_contato  public.contatos%rowtype;
  v_nome     text := nullif(btrim(coalesce(p_nome, '')), '');
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

  -- Mesma porta da fila: sem termo aceito não se atende ninguém, e cadastrar
  -- pelo botão não pode virar a saída pelos fundos dessa regra.
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

  if p_telefone_e164 is null or p_telefone_hmac is null or p_chave_dedup is null then
    return jsonb_build_object('ok', false, 'motivo', 'telefone_invalido');
  end if;

  -- ── Pediu saída antes ─────────────────────────────────────────────────────
  -- Recusa. No formulário público o bloqueio cai, porque lá existe um aceite
  -- novo com data, hora e IP da própria pessoa. Aqui a única prova seria a
  -- palavra do atendente, e desfazer um pedido de saída com base nisso é
  -- exatamente o que gera multa por mensagem. Fica para o gestor.
  if exists (select 1 from public.bloqueios b where b.telefone_hmac = p_telefone_hmac) then
    insert into public.alertas (tipo, atendente_id, detalhe)
    values ('cadastro_de_bloqueado_recusado', v_uid,
            'Um atendente tentou cadastrar um número que está na lista de bloqueio. ' ||
            'Se a pessoa realmente voltou a procurar a campanha, só o gestor pode liberar.');
    return jsonb_build_object('ok', false, 'motivo', 'numero_bloqueado');
  end if;

  -- ── Já conhecemos esse número? ────────────────────────────────────────────
  -- A busca é pelo HMAC: é o único identificador que sobrevive à purga de 48h.
  select * into v_existente
    from public.contatos c
   where c.telefone_hmac = p_telefone_hmac
   for update;

  if found then
    -- Já é dele: não duplica, só devolve. Cadastrar duas vezes o mesmo número
    -- é o caminho mais curto para dois atendentes falarem com a mesma pessoa.
    if v_existente.atendente_id = v_uid then
      update public.contatos
         set nome            = coalesce(v_nome, nome),
             primeiro_nome   = coalesce(split_part(v_nome, ' ', 1), primeiro_nome),
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

    -- É de outro atendente. Não se tira contato de ninguém por um botão: o
    -- outro pode estar no meio da conversa, e duas abordagens no mesmo número
    -- é o que vira denúncia. O nome sai junto para os dois se acertarem.
    if v_existente.atendente_id is not null then
      select u.primeiro_nome into v_dono
        from public.usuarios u where u.id = v_existente.atendente_id;
      return jsonb_build_object(
        'ok', false, 'motivo', 'ja_e_de_outro_atendente',
        'atendente', coalesce(v_dono, 'outro atendente')
      );
    end if;

    -- Está na base sem dono (veio de importação e ninguém pegou ainda).
    -- Passa a ser dele: quem recebeu a mensagem é quem responde.
    update public.contatos
       set nome            = coalesce(v_nome, nome),
           primeiro_nome   = coalesce(split_part(v_nome, ' ', 1), primeiro_nome),
           telefone_e164   = p_telefone_e164,
           chave_dedup     = p_chave_dedup,
           municipio_id    = coalesce(p_municipio_id, municipio_id),
           anonimizado_em  = null,
           -- A origem só vira 'chamou' se o número NÃO veio de uma lista.
           --
           -- Se veio, ele continua 'lista_fria' mesmo que a pessoa tenha escrito
           -- primeiro. A frase de {{origem}} é a divulgação de como obtivemos o
           -- número, e nós já o tínhamos: trocar para "você me chamou" calaria
           -- justamente o "um apoiador me passou seu contato" que essa pessoa
           -- tem direito de ouvir. As duas coisas são verdade; a que ela precisa
           -- saber é a que ela não viu acontecer.
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
    ('chamou', v_nome, nullif(split_part(coalesce(v_nome, ''), ' ', 1), ''),
     p_telefone_e164, p_chave_dedup,
     p_telefone_hmac, p_hmac_versao, p_municipio_id, p_candidato_id,
     'em_atendimento', v_uid, p_chip_id, now(),
     now() + make_interval(mins => v_cfg.lease_minutos))
  returning * into v_contato;

  -- A pessoa escreveu para ESTE atendente sobre ESTA candidatura. Entra na
  -- lista de quem pode alcançá-la, igual ao que o formulário público faz — sem
  -- isso a tela ofereceria um material que o servidor recusaria a enviar.
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
  -- Dois cadastros do mesmo número ao mesmo tempo: o UNIQUE INDEX de
  -- `chave_dedup` decide, e quem perdeu recebe uma resposta em português em vez
  -- de um erro de banco na tela.
  when unique_violation then
    return jsonb_build_object('ok', false, 'motivo', 'numero_repetido');
end;
$$;

revoke execute on function public.adicionar_contato(text, text, text, text, int, uuid, smallint, uuid) from anon, public;
grant  execute on function public.adicionar_contato(text, text, text, text, int, uuid, smallint, uuid) to authenticated;
