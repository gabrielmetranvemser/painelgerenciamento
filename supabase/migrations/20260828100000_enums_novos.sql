-- =============================================================================
-- Valores novos de enum — e SÓ isso
-- =============================================================================
-- ⚠️ ESTA MIGRATION EXISTE SOZINHA DE PROPÓSITO, e não por organização.
--
-- `alter type ... add value` roda dentro de transação no Postgres 12+, mas o
-- valor recém-criado NÃO pode ser usado na mesma transação — nem num `check`,
-- nem numa comparação, nem num `case`. Cada arquivo de migration é uma
-- transação. Juntar a criação do valor com o código que o usa faz o `db push`
-- falhar com "unsafe use of new value of enum type", e falhar no meio: parte
-- do arquivo já aplicada, parte não.
--
-- Então: valores novos entram aqui, e quem os usa entra nas migrations
-- seguintes.

-- ── Por que a fila se recusou a entregar ────────────────────────────────────
-- Atendente sem candidato atribuído não pode abordar ninguém: a primeira
-- mensagem sairia dizendo "tô ajudando  nessa eleição", sem nome nenhum, e a
-- pessoa autorizaria material de quem ela não sabe quem é. Ver a migration
-- `chapa_obrigatoria_na_permissao`.
alter type public.motivo_fila add value if not exists 'sem_candidato';

-- ── Desfechos novos de uma conversa ─────────────────────────────────────────
-- Vieram dos testes com os atendentes: os cinco desfechos existentes não
-- cobriam o que de fato acontece na conversa, e quem não achava onde encaixar
-- marcava qualquer coisa para poder seguir — o que envenena o relatório
-- inteiro.
--
--   ja_apoia        já é apoiador; não precisa ser convencido
--   falar_depois    pediu para falar em outro momento (volta para a fila DELE)
--   nao_e_a_pessoa  o número trocou de dono, ou é de outra pessoa
--   mudou_de_estado saiu de Rondônia; não vota aqui
--   outro           qualquer coisa fora da lista, com uma linha escrita
--
-- `sem_resposta` já existia no enum e passa a ser marcável pelo atendente.
alter type public.status_contato add value if not exists 'ja_apoia';
alter type public.status_contato add value if not exists 'falar_depois';
alter type public.status_contato add value if not exists 'nao_e_a_pessoa';
alter type public.status_contato add value if not exists 'mudou_de_estado';
alter type public.status_contato add value if not exists 'outro';

-- ── Mensagem que o gestor escreveu ──────────────────────────────────────────
-- As sete etapas continuam sendo as sete etapas: são elas que sustentam as
-- travas, a rotação por chip e a auditoria. `livre` é a etiqueta de tudo que o
-- gestor criar em `modelos_livres` — o QUAL modelo fica na coluna própria da
-- interação, não em valores novos de enum a cada texto que alguém escreve.
alter type public.etapa_msg add value if not exists 'livre';
