-- =============================================================================
-- Duas etapas novas antes da Permissão: Abertura e Minha escolha
-- =============================================================================
-- A conversa passa a ter a forma que o roteiro da campanha sempre teve no papel
-- (SCRIPTAPOIO, §1 a §3) e que o painel não acompanhava:
--
--   1. Abertura        "Oi! Boa tarde! Tudo bem?"          — e espera responder
--   2. Minha escolha   "decidi meu voto e quis te contar"  — o coração
--   3. Permissão       "posso te mandar o material?"       — congela o consentimento
--   4. Material        depois do "pode"
--
-- Mandar tudo de uma vez é o que faz a mensagem parecer disparo. Quem manda um
-- "oi" e espera a resposta está conversando; quem manda três parágrafos com
-- pedido e link, não.
--
-- ⚠️ ESTA MIGRATION SÓ ACRESCENTA OS VALORES AO ENUM. Postgres não deixa usar
-- um valor de enum na MESMA transação em que ele foi criado, e é por isso que
-- os modelos, os textos e a mudança de `etapa_de_abordagem` estão no arquivo
-- seguinte. Separar não é estilo: junto, a migration falha.

alter type public.etapa_msg add value if not exists 'abertura' before 'permissao';
alter type public.etapa_msg add value if not exists 'minha_escolha' before 'permissao';
