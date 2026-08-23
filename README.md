# Painel de Gerenciamento de Contatos

Painel que organiza atendimento **manual** por WhatsApp: entrega o contato certo
ao atendente certo com o texto pronto, registra o resultado e faz cumprir as
regras de volume, horário e privacidade.

> **O sistema não envia mensagem.** Quem conversa é o atendente, pelo WhatsApp
> Web dele. O painel monta o texto e abre a conversa; o envio é sempre humano.
> Ver [`CLAUDE.md`](CLAUDE.md) e [`docs/01-VISAO-GERAL.md`](docs/01-VISAO-GERAL.md) §2.

## Documentação

| Documento | Conteúdo |
|---|---|
| [`docs/01-VISAO-GERAL.md`](docs/01-VISAO-GERAL.md) | Conceito, escopo, alertas jurídicos, custos |
| [`docs/02-CONSTRUCAO-TECNICA.md`](docs/02-CONSTRUCAO-TECNICA.md) | Arquitetura, banco, RLS, extensão |
| [`docs/03-OPERACAO.md`](docs/03-OPERACAO.md) | Uso diário, textos, checklists |
| [`CLAUDE.md`](CLAUDE.md) | Regras de código que não se negociam |

## Rodar

```bash
npm install
cp .env.example .env.local   # preencher
npm run dev
```

## Comandos

```bash
npm test           # funções críticas — rodar antes de qualquer commit
npm run typecheck
npm run build
npm run lint
```

## Estado

| Bloco | Situação |
|---|---|
| 0 · Fundação | ✅ Next.js, Tailwind, Vitest, CLAUDE.md |
| 1 · Funções críticas | ✅ telefone, hmac, bots, mensagem — 169 testes |
| 2 · Banco (schema, RLS, RPCs) | ⬜ |
| 3 · Auth + termo | ⬜ |
| 4 · Importação de lista | ⬜ |
| 5 · Tela do atendente | ⬜ |
| 6 · Links rastreados + captação | ⬜ |
| 7 · Painel do gestor | ⬜ |
| 8 · Automações (cron) | ⬜ |
| 9 · Extensão Chrome (fase 2) | ⬜ |
