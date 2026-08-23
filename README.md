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
| 0 · Fundação | ✅ Next.js 16, Tailwind 4, Vitest |
| 1 · Funções críticas | ✅ telefone, hmac, bots, mensagem, importação, csv |
| 2 · Banco | ✅ 17 tabelas, RLS total, 12 RPCs, 3 crons |
| 3 · Auth + termo | ✅ cookie httpOnly, middleware, aceite datado |
| 4 · Importação | ✅ CSV, mapeador de colunas, conferência, blocos de 500 |
| 5 · Tela do atendente | ✅ fila, travas, 13 casos, atalhos 1–5, mensagem de seguimento por resultado |
| 5b · Perfil do contato | ✅ histórico, correção de resultado, mensagens avulsas, pedido de kit |
| 6 · Links + captação | ✅ /r/[token] com filtro de bot, /m/[token], /kit, /site, /privacidade |
| 7 · Painel do gestor | ✅ visão geral, atendentes, números, mensagens, config, relatórios |
| 8 · Automações | ✅ lease, 72h, purga LGPD |
| 9 · Extensão Chrome | ✅ painel lateral Nível 0, instalação local — ver [extensao/LEIA-ME.md](extensao/LEIA-ME.md) |
| 10 · Onboarding | ✅ `/instalar` — 5 passos guiados + download da extensão já configurada |

## Testes

```bash
npm run test:tudo     # typecheck + unitários + tipos do banco + banco
```

| Suíte | O que cobre |
|---|---|
| `npm test` | 213 testes: normalização de telefone (40 formatos reais), HMAC, filtro de bot, blocos travados, importação, CSV |
| `npm run tipos` | compara `src/lib/tipos-banco.ts` coluna a coluna com o banco |
| `npm run test:banco` | 16 travas de servidor, 4 automações, 4 de concorrência da fila |

Os testes de banco são autossuficientes: criam os próprios dados e dão rollback.
Podem rodar com a base em produção sem deixar resíduo.

## Scripts

```bash
node scripts/criar-usuario.mjs <email> <nome> [gestor|atendente]
npm run semear            # contatos de teste, pelas funções reais
npm run importar:teste    # roda o pipeline de importação num CSV
```
