-- =============================================================================
-- A tela do gestor precisa saber qual encaminhamento já foi tratado
-- =============================================================================
-- A view vem INTEIRA da versão anterior — `create or replace view` substitui a
-- definição toda, não dá para acrescentar uma coluna sozinha.
--
-- ⚠️ E a coluna nova vai no FIM da lista, não ao lado de `encaminhamento`, que
-- seria o lugar natural: `create or replace view` recusa mudança de ordem
-- ("cannot change name of view column"). A alternativa seria `drop view`, que
-- derrubaria junto tudo que depende dela. A ordem não importa para quem lê —
-- `contatos_do_gestor` devolve as linhas com `to_jsonb`.

create or replace view public.v_contatos_gestor
with (security_invoker = on) as
SELECT c.id,
    c.nome,
    c.primeiro_nome,
    c.telefone_e164,
    c.origem,
    c.status,
    c.municipio_id,
    m.nome AS municipio,
    c.atendente_id,
    u.primeiro_nome AS atendente,
    ch.rotulo AS chip,
    c.candidato_origem_id,
    cand.nome_urna AS candidato_origem,
    l.rotulo AS lista,
    c.primeiro_contato_em,
    c.resultado_em,
    c.criado_em,
    c.encaminhamento,
    c.anonimizado_em,
    c.claim_expira_em,
    c.adiado_ate,
    ( SELECT count(*)::integer AS count
           FROM interacoes i
          WHERE i.contato_id = c.id AND i.aberto_wa_em IS NOT NULL) AS mensagens,
    ( SELECT count(*)::integer AS count
           FROM contato_candidato cc
          WHERE cc.contato_id = c.id AND cc.material_enviado_em IS NOT NULL) AS materiais_enviados,
    ( SELECT count(*)::integer AS count
           FROM v_cliques_reais v
          WHERE v.contato_id = c.id) AS cliques,
    (EXISTS ( SELECT 1
           FROM captacoes cap
          WHERE cap.contato_id = c.id AND cap.itens IS NOT NULL AND cap.entregue_em IS NULL AND cap.cancelado_em IS NULL)) AS kit_pendente,
    c.lista_id,
    c.encaminhamento_tratado_em
   FROM contatos c
     LEFT JOIN municipios m ON m.id = c.municipio_id
     LEFT JOIN usuarios u ON u.id = c.atendente_id
     LEFT JOIN chips ch ON ch.id = c.chip_id
     LEFT JOIN candidatos cand ON cand.id = c.candidato_origem_id
     LEFT JOIN listas l ON l.id = c.lista_id;
