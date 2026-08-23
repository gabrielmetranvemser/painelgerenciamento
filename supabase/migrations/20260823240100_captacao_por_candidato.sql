-- =============================================================================
-- Captação com dono: de qual candidatura o lead veio, e o que a pessoa aceitou
-- =============================================================================

alter table public.captacoes
  add column if not exists candidato_id uuid references public.candidatos(id) on delete set null,
  -- O texto EXATO que a pessoa marcou, copiado no ato.
  --
  -- Guardar só "aceite_em" prova que alguém clicou numa caixa; não prova em
  -- QUE ela clicou. Se o gestor editar a página depois, a frase de hoje some e
  -- some junto a prova do que foi consentido. Por isso a frase é congelada aqui,
  -- linha a linha, junto com data, hora e IP.
  add column if not exists texto_aceite text;

create index if not exists captacoes_candidato_idx
  on public.captacoes (candidato_id, criado_em desc)
  where candidato_id is not null;

-- ── Quem chegou pela página de um candidato ───────────────────────────────
-- Relatório do gestor: quanto cada link de candidato trouxe, e quanto disso
-- virou conversa de verdade.
create or replace view public.v_captacao_por_candidato with (security_invoker = on) as
select c.id            as candidato_id,
       c.nome_urna,
       c.slug,
       count(*)                                                as cadastros,
       count(*) filter (where cap.itens is not null)           as pediram_kit,
       count(*) filter (where cap.virou_contato)               as viraram_contato,
       count(distinct cc.contato_id) filter (where cc.material_enviado_em is not null)
                                                               as receberam_material,
       max(cap.criado_em)                                      as ultimo_em
  from public.candidatos c
  left join public.captacoes cap on cap.candidato_id = c.id
  left join public.contato_candidato cc
         on cc.candidato_id = c.id and cc.contato_id = cap.contato_id
 group by c.id, c.nome_urna, c.slug;
