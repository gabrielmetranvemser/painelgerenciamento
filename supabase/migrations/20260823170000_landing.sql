-- =============================================================================
-- Conteúdo das páginas públicas
-- =============================================================================

alter table public.config
  add column if not exists material_titulo text not null default '',
  add column if not exists material_texto  text not null default '',
  add column if not exists kit_ativo        boolean not null default true,
  add column if not exists responsavel_dados text not null default '';

-- O destino aceita {token}, que `/r/{token}` substitui antes de redirecionar.
-- Assim o gestor escolhe entre a nossa página (que tem descadastro e aviso de
-- privacidade) e uma URL externa, sem mudar código.
update public.destinos set url = '/m/{token}' where chave = 'material';

update public.config set
  material_titulo = coalesce(nullif(material_titulo, ''), 'Material da campanha'),
  material_texto  = coalesce(nullif(material_texto, ''),
    'Escreva aqui as propostas em Gestor → Configuração. Este texto é o que a pessoa vê ao abrir o link.')
where id = 1;

-- ── Descadastro pela landing ────────────────────────────────────────────────
-- A pessoa que recebeu o link pode sair sozinha, sem falar com ninguém.
-- Bloqueia e agenda a purga em 48h, igual ao "Pediu saída" do atendimento.
create or replace function public.descadastrar_por_token(p_token text)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare v_contato public.contatos%rowtype;
begin
  select c.* into v_contato
    from public.links l join public.contatos c on c.id = l.contato_id
   where l.token = p_token;

  if v_contato.id is null then
    -- Resposta idêntica à do sucesso: token inexistente não pode ser
    -- distinguível de token válido por quem estiver sondando.
    return jsonb_build_object('ok', true);
  end if;

  insert into public.bloqueios (telefone_hmac, hmac_versao, motivo, origem, contato_id, apagar_em)
  values (v_contato.telefone_hmac, v_contato.hmac_versao,
          'Descadastro pela página do link', 'landing', v_contato.id,
          now() + interval '48 hours')
  on conflict (telefone_hmac) do nothing;

  update public.contatos
     set status = 'pediu_saida', resultado_em = now(), claim_expira_em = null
   where id = v_contato.id and status <> 'pediu_saida';

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.descadastrar_por_token(text) from anon, public, authenticated;
