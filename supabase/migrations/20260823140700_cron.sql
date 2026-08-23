-- =============================================================================
-- Automações
-- =============================================================================

create extension if not exists pg_cron;

-- ── Fechar quem não respondeu ───────────────────────────────────────────────
-- 72h depois da abordagem sem resultado, o contato sai do limbo. Não volta para
-- a fila: uma tentativa por pessoa, nunca insistir (docs/03-OPERACAO.md §4).
create or replace function public.fechar_sem_resposta()
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  with fechados as (
    update public.contatos c
       set status = 'sem_resposta', resultado_em = now(), claim_expira_em = null
     where c.status = 'em_atendimento'
       and c.primeiro_contato_em is not null
       and c.primeiro_contato_em < now() - interval '72 hours'
     returning 1
  ) select count(*)::int into v_n from fechados;
  return v_n;
end;
$$;

-- ── Purga LGPD dos que pediram saída ────────────────────────────────────────
-- Apaga nome, telefone e a chave de dedup. MANTÉM o telefone_hmac: é o que
-- impede o número de voltar numa importação futura. Isso cumpre as duas
-- promessas ao mesmo tempo — apagar o dado e nunca mais falar com a pessoa.
create or replace function public.purgar_dados_de_saida()
returns int
language plpgsql security definer set search_path = ''
as $$
declare v_n int;
begin
  with purgados as (
    update public.contatos c
       set nome = null,
           primeiro_nome = null,
           telefone_e164 = null,
           chave_dedup = null,
           encaminhamento = null,
           anonimizado_em = now()
      from public.bloqueios b
     where b.telefone_hmac = c.telefone_hmac
       and b.apagar_em < now()
       and c.anonimizado_em is null
     returning 1
  ) select count(*)::int into v_n from purgados;
  return v_n;
end;
$$;

revoke execute on function public.fechar_sem_resposta()   from anon, public, authenticated;
revoke execute on function public.purgar_dados_de_saida() from anon, public, authenticated;

-- ── Agendamento ─────────────────────────────────────────────────────────────
-- pg_cron roda em UTC. Rondônia é UTC−4, então 07:00 UTC = 03:00 local.
select cron.schedule('expirar-leases',    '*/5 * * * *', $$select public.expirar_leases()$$);
select cron.schedule('sem-resposta-72h',  '10 7 * * *',  $$select public.fechar_sem_resposta()$$);
select cron.schedule('purga-lgpd',        '20 7 * * *',  $$select public.purgar_dados_de_saida()$$);
