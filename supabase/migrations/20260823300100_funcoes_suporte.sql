-- =============================================================================
-- As funções do suporte
-- =============================================================================
-- Tudo por RPC `security definer`: chamado é registro de risco, e registro que
-- o próprio interessado edita depois não vale como registro.

/** Abre um chamado e grava a primeira mensagem no mesmo commit. */
create or replace function public.abrir_chamado(
  p_motivo     public.motivo_chamado,
  p_assunto    text,
  p_texto      text,
  p_contato_id uuid default null,
  p_chip_id    uuid default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_chamado  uuid;
  v_mensagem uuid;
begin
  if v_uid is null or not public.sou_ativo() then
    return jsonb_build_object('ok', false, 'motivo', 'usuario_inativo');
  end if;
  if length(btrim(coalesce(p_assunto, ''))) < 3 then
    return jsonb_build_object('ok', false, 'motivo', 'assunto_curto');
  end if;
  if length(btrim(coalesce(p_texto, ''))) < 1 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;

  -- Só dá para anexar um contato que é seu. Sem isso, o campo viraria uma
  -- forma de ler o nome de qualquer pessoa da base pelo id.
  if p_contato_id is not null
     and not exists (select 1 from public.contatos c
                      where c.id = p_contato_id
                        and (c.atendente_id = v_uid or public.is_gestor())) then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;

  if p_chip_id is not null
     and not exists (select 1 from public.chips ch
                      where ch.id = p_chip_id
                        and (ch.atendente_id = v_uid or public.is_gestor())) then
    return jsonb_build_object('ok', false, 'motivo', 'chip_nao_e_seu');
  end if;

  insert into public.chamados (atendente_id, motivo, assunto, contato_id, chip_id)
  values (v_uid, p_motivo, btrim(p_assunto), p_contato_id, p_chip_id)
  returning id into v_chamado;

  insert into public.chamado_mensagens (chamado_id, autor_id, texto)
  values (v_chamado, v_uid, btrim(p_texto))
  returning id into v_mensagem;

  return jsonb_build_object('ok', true, 'chamado_id', v_chamado, 'mensagem_id', v_mensagem);
end;
$$;

/** Responde num chamado. Vale para o atendente dono e para o gestor. */
create or replace function public.responder_chamado(p_chamado_id uuid, p_texto text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid      uuid := (select auth.uid());
  v_chamado  public.chamados%rowtype;
  v_mensagem uuid;
  v_gestor   boolean := public.is_gestor();
begin
  select * into v_chamado from public.chamados where id = p_chamado_id;
  if v_chamado.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'chamado_nao_encontrado');
  end if;
  if v_chamado.atendente_id <> v_uid and not v_gestor then
    return jsonb_build_object('ok', false, 'motivo', 'chamado_nao_e_seu');
  end if;
  if length(btrim(coalesce(p_texto, ''))) < 1 then
    return jsonb_build_object('ok', false, 'motivo', 'texto_vazio');
  end if;

  insert into public.chamado_mensagens (chamado_id, autor_id, texto)
  values (p_chamado_id, v_uid, btrim(p_texto))
  returning id into v_mensagem;

  -- Resposta do gestor tira o chamado de "aberto": é o que separa, na lista
  -- dele, o que ninguém olhou do que já está andando.
  if v_gestor and v_chamado.atendente_id <> v_uid then
    update public.chamados
       set respondido_em = coalesce(respondido_em, now()),
           status = case when status = 'aberto' then 'em_analise' else status end
     where id = p_chamado_id;
  elsif v_chamado.status = 'resolvido' then
    -- O atendente escreveu num chamado fechado: reabre, senão a resposta dele
    -- fica num lugar que o gestor não olha mais.
    update public.chamados set status = 'em_analise', resolvido_em = null, resolvido_por = null
     where id = p_chamado_id;
  end if;

  return jsonb_build_object('ok', true, 'mensagem_id', v_mensagem);
end;
$$;

/** Muda o estado do chamado. Só o gestor. */
create or replace function public.mudar_status_chamado(
  p_chamado_id uuid,
  p_status     public.status_chamado
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_uid uuid := (select auth.uid());
begin
  if not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'restrito_ao_gestor');
  end if;

  update public.chamados
     set status = p_status,
         resolvido_em  = case when p_status = 'resolvido' then now() else null end,
         resolvido_por = case when p_status = 'resolvido' then v_uid else null end
   where id = p_chamado_id;

  if not found then
    return jsonb_build_object('ok', false, 'motivo', 'chamado_nao_encontrado');
  end if;
  return jsonb_build_object('ok', true, 'status', p_status);
end;
$$;

/**
 * Registra um anexo já enviado ao balde.
 *
 * O upload em si é feito pelo servidor com service_role; esta função existe
 * para o registro nascer amarrado a QUEM enviou e a QUAL chamado — e para
 * recusar quem tenta pendurar arquivo no chamado de outra pessoa.
 */
create or replace function public.registrar_anexo(
  p_chamado_id uuid,
  p_caminho    text,
  p_bytes      int,
  p_largura    int default null,
  p_altura     int default null
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_chamado public.chamados%rowtype;
  v_id      uuid;
begin
  select * into v_chamado from public.chamados where id = p_chamado_id;
  if v_chamado.id is null then
    return jsonb_build_object('ok', false, 'motivo', 'chamado_nao_encontrado');
  end if;
  if v_chamado.atendente_id <> v_uid and not public.is_gestor() then
    return jsonb_build_object('ok', false, 'motivo', 'chamado_nao_e_seu');
  end if;

  insert into public.chamado_anexos (chamado_id, autor_id, caminho, bytes, largura, altura)
  values (p_chamado_id, v_uid, p_caminho, p_bytes, p_largura, p_altura)
  returning id into v_id;

  return jsonb_build_object('ok', true, 'anexo_id', v_id);
end;
$$;

/** Quem pode ver este anexo. A rota do painel pergunta antes de assinar a URL. */
create or replace function public.posso_ver_anexo(p_anexo_id uuid)
returns jsonb
language plpgsql stable security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_caminho text;
  v_dono    uuid;
begin
  select a.caminho, c.atendente_id into v_caminho, v_dono
    from public.chamado_anexos a
    join public.chamados c on c.id = a.chamado_id
   where a.id = p_anexo_id;

  if v_caminho is null then return jsonb_build_object('ok', false); end if;
  if v_dono <> v_uid and not public.is_gestor() then
    return jsonb_build_object('ok', false);
  end if;
  return jsonb_build_object('ok', true, 'caminho', v_caminho);
end;
$$;

revoke execute on function public.abrir_chamado(public.motivo_chamado, text, text, uuid, uuid) from anon, public;
revoke execute on function public.responder_chamado(uuid, text) from anon, public;
revoke execute on function public.mudar_status_chamado(uuid, public.status_chamado) from anon, public;
revoke execute on function public.registrar_anexo(uuid, text, int, int, int) from anon, public;
revoke execute on function public.posso_ver_anexo(uuid) from anon, public;

grant execute on function public.abrir_chamado(public.motivo_chamado, text, text, uuid, uuid) to authenticated;
grant execute on function public.responder_chamado(uuid, text) to authenticated;
grant execute on function public.mudar_status_chamado(uuid, public.status_chamado) to authenticated;
grant execute on function public.registrar_anexo(uuid, text, int, int, int) to authenticated;
grant execute on function public.posso_ver_anexo(uuid) to authenticated;

-- ── A lista que o gestor abre ─────────────────────────────────────────────
create or replace view public.v_chamados with (security_invoker = on) as
select
  c.id,
  c.motivo,
  c.assunto,
  c.status,
  c.criado_em,
  c.respondido_em,
  c.resolvido_em,
  c.atendente_id,
  u.primeiro_nome                          as atendente,
  c.contato_id,
  ct.nome                                  as contato,
  ct.telefone_e164                         as contato_telefone,
  ch.rotulo                                as chip,
  (select count(*)::int from public.chamado_mensagens m where m.chamado_id = c.id) as mensagens,
  (select count(*)::int from public.chamado_anexos  a where a.chamado_id = c.id)   as anexos,
  (select max(m.criado_em) from public.chamado_mensagens m where m.chamado_id = c.id) as ultima_em,
  -- Quem falou por último. Se foi o atendente, a bola está com o gestor.
  (select m.autor_id = c.atendente_id from public.chamado_mensagens m
    where m.chamado_id = c.id order by m.criado_em desc limit 1)                  as espera_gestor
from public.chamados c
left join public.usuarios u  on u.id = c.atendente_id
left join public.contatos ct on ct.id = c.contato_id
left join public.chips ch    on ch.id = c.chip_id;

-- ── O contador do painel do gestor ────────────────────────────────────────
create or replace view public.v_resumo with (security_invoker = on) as
select
  (select count(*) from public.contatos where status = 'na_fila')            as na_fila,
  (select count(*) from public.contatos where status = 'na_fila' and origem <> 'lista_fria') as fila_quente,
  (select count(*) from public.contatos where status = 'na_fila' and origem = 'lista_fria')  as fila_fria,
  (select count(*) from public.contatos where status = 'em_atendimento')     as em_atendimento,
  (select count(*) from public.contatos where primeiro_contato_em is not null) as abordados,
  (select count(*) from public.contatos where status = 'autorizou')          as autorizou,
  (select count(*) from public.contatos where status = 'pediu_saida')        as pediu_saida,
  (select count(*) from public.contatos where status = 'sem_resposta')       as sem_resposta,
  (select count(*) from public.contatos where status = 'perdido')            as perdidos,
  (select count(distinct contato_id) from public.v_cliques_reais)            as cliques_reais,
  (select count(*) from public.interacoes
    where dia_operacional = public.hoje_operacional() and aberto_wa_em is not null
      and etapa = 'permissao')                                               as abordados_hoje,
  (select count(*) from public.alertas where resolvido_em is null)           as alertas_abertos,
  (select count(*) from public.chamados where status <> 'resolvido')         as chamados_abertos,
  -- Risco jurídico em aberto tem contador próprio: é o único que não pode
  -- esperar a próxima vez que alguém lembrar de olhar a lista.
  (select count(*) from public.chamados
    where status <> 'resolvido' and motivo = 'juridico')                     as juridicos_abertos;
