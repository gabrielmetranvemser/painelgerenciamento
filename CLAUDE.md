# Painel de Gerenciamento de Contatos

## O princípio que define o projeto inteiro

> **O sistema NUNCA envia mensagem sozinho.**
> O envio é sempre manual: o painel monta o texto e abre o WhatsApp Web do
> atendente com a conversa preenchida. Quem revisa e aperta enviar é a pessoa.
>
> **Não sugerir, não instalar e não escrever código com Baileys, Evolution API,
> venom-bot, wppconnect, Puppeteer sobre o WhatsApp, lista de transmissão ou
> qualquer forma de envio automático — em nenhuma hipótese, nem "só para testar".**

Isso não é preferência técnica. É o que mantém a operação (a) barata, (b) com os
números vivos e (c) juridicamente defensável: no instante em que o software
dispara, deixa de ser "conversa entre pessoas" e vira "disparo em massa", que é
vedado na eleição. Ver `docs/01-VISAO-GERAL.md` §2.

## O que é

Painel que organiza atendimento manual por WhatsApp numa campanha eleitoral em
Rondônia: entrega o contato certo ao atendente certo com o texto pronto, registra
o resultado e faz cumprir as regras de volume, horário e privacidade.

- `docs/01-VISAO-GERAL.md` — conceito, escopo, alertas jurídicos
- `docs/02-CONSTRUCAO-TECNICA.md` — arquitetura, banco, extensão
- `docs/03-OPERACAO.md` — uso diário, textos, checklists

## Stack

Next.js 16 (App Router) · TypeScript · Tailwind 4 · Supabase (Postgres + Auth +
RLS + pg_cron) · Vercel. **Sem servidor de WhatsApp. Sem VPS. Sem Docker.**

## Regras de código que não se negociam

### 1. Não alterar as funções críticas sem rodar `npm test`

| Arquivo | O que quebra se errar |
|---|---|
| `src/lib/telefone.ts` | dois atendentes falam com a mesma pessoa → denúncia |
| `src/lib/hmac.ts` | quem pediu saída volta para a fila → multa por mensagem |
| `src/lib/bots.ts` | o pré-carregamento de link do WhatsApp vira "clique" → métrica inútil |
| `src/lib/mensagem.ts` | texto sai sem os blocos travados → perde a defesa jurídica |

### 2. Toda trava é validada no SERVIDOR

Teto diário, janela de horário, intervalo mínimo, dia bloqueado, termo aceito,
lista de bloqueio: tudo dentro de RPC `security definer` no Postgres. O frontend
só reflete o que o servidor respondeu. Frontend se burla abrindo o DevTools.

### 3. Atendente não escreve em `contatos` pelo RLS

`SELECT` só nas próprias linhas; `UPDATE`/`INSERT`/`DELETE` negados. Toda mutação
passa por RPC (`pegar_proximo_contato`, `registrar_abertura`,
`registrar_resultado`). Sem isso um atendente se auto-atribui a base inteira.

Nas policies, usar `public.is_gestor()` (função `stable security definer`) e
`(select auth.uid())` — consultar `usuarios` direto dentro da policy causa
recursão infinita, e `auth.uid()` sem o `select` mata a performance.

### 4. Nunca gravar preferência de voto

Dado sensível, vedado. Não existe campo para isso em nenhuma tabela e não se
cria um — nem "observação", nem "etiqueta", nem "campo livre".

### 5. Segredos

`SUPABASE_SERVICE_ROLE_KEY` e `HMAC_SECRET` só no servidor, só em variável de
ambiente. Módulos que os usam começam com `import 'server-only'`.
**Nunca versionar `.env`.**

Trocar a `HMAC_SECRET` invalida a lista de bloqueio inteira. Não rotacionar
durante a campanha.

### 6. Fuso horário

O Postgres roda em UTC; a operação é em `America/Porto_Velho` (**UTC−4**).
Toda conta de hora, saudação e "dia operacional" usa `config.timezone`.
Nunca `now()` cru para decidir se está dentro do horário.

### 7. Nada de dado pessoal em URL

O token de `/r/{token}` é aleatório e aponta para o contato no banco. Telefone,
nome e município nunca vão para a query string.

## Convenções

- Código, comentários, nomes de tabela e UI em **português**.
- Nomes de coluna em `snake_case`; TypeScript em `camelCase`.
- `telefone_e164` é **só dígitos, sem `+`**: `"5569981234567"`. É o que a URL
  `web.whatsapp.com/send?phone=` espera.
- `chave_dedup` é `DDD + 8 dígitos finais` (sem o nono): `"6981234567"`.
  É a identidade da pessoa no sistema e tem `UNIQUE INDEX`.

## Comandos

```bash
npm run dev        # servidor de desenvolvimento
npm test           # funções críticas — rodar antes de qualquer commit
npm run typecheck  # tsc --noEmit
npm run build      # build de produção
npm run lint
```

Migrations: `supabase db push` contra o projeto remoto (não há stack local —
esta máquina não tem Docker).

## Infraestrutura

**Não usar a org Supabase `Setup` nem o time Vercel `Agencia Setup`.** Este
projeto roda em contas próprias. Repo: `gabrielmetranvemser/painelgerenciamento`.

---

Regras específicas desta versão do Next.js: @AGENTS.md
