-- =============================================================================
-- O contato chega dizendo em que passo a conversa está
-- =============================================================================
-- Com quatro passos, a tela do atendente precisa saber onde aquela pessoa parou
-- — e a resposta não pode ser calculada no navegador.
--
-- Um contato volta para a fila, é adiado, é escolhido a dedo ou é reaberto por
-- "Meus contatos" dias depois. Em todos esses caminhos ele pode já ter recebido
-- a Abertura e não a Minha escolha, ou as duas e não a Permissão. Deixar a tela
-- adivinhar produziria o pior erro possível deste sistema: mandar de novo uma
-- mensagem que a pessoa já recebeu.
--
-- `passos` traz as etapas de abordagem que REALMENTE saíram (`aberto_wa_em`
-- preenchido). A tela pega a primeira que falta e para quando não falta nenhuma.
create or replace function public.contato_json(c public.contatos)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select jsonb_build_object(
    'id',            c.id,
    'nome',          c.nome,
    'primeiro_nome', c.primeiro_nome,
    'telefone_e164', c.telefone_e164,
    'origem',        c.origem,
    'status',        c.status,
    'municipio',     (select m.nome from public.municipios m where m.id = c.municipio_id),
    'municipio_id',  c.municipio_id,
    'lista_id',      c.lista_id,
    'lista',         (select l.rotulo from public.listas l where l.id = c.lista_id),
    'claim_expira_em', c.claim_expira_em,
    'passos', coalesce((
      select jsonb_agg(distinct i.etapa::text)
        from public.interacoes i
       where i.contato_id = c.id
         and i.aberto_wa_em is not null
         and i.etapa in ('abertura', 'minha_escolha', 'permissao')
    ), '[]'::jsonb)
  );
$$;
