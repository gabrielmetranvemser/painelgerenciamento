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
| `src/lib/importacao.ts` | dedup e casamento de município da planilha |
| `pegar_proximo_contato` | dois atendentes pegam o mesmo contato

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

### 7. O painel vive sob um segmento secreto

Tudo que é interno responde em `/{PAINEL_CHAVE}/…`. Fora dele, 404 — a MESMA
resposta de qualquer endereço inexistente. Nada pode distinguir "endereço
errado" de "endereço certo com chave errada": nem status, nem redirecionamento,
nem texto.

⚠️ **Isso é obscuridade, não segurança.** A tranca continua sendo a
autenticação e o RLS. Nunca trate a chave como se fosse proteção.

Regras que caem disso:

- **A chave NUNCA vai para o pacote JavaScript.** Links internos são montados a
  partir do segmento que já está na URL (`params.entrada` → `rotas(entrada)` em
  `src/lib/links-internos.ts`). Não crie `NEXT_PUBLIC_PAINEL_CHAVE`.
- **Metadado padrão é neutro.** O layout raiz não tem descrição e o título
  padrão é genérico; quem põe "· Painel" é o layout interno. Assim, uma página
  pública que esqueça de sobrescrever não vaza nada — foi exatamente o defeito
  que /privacidade teve.
- **`robots.txt` bloqueia tudo e não lista caminho.** Dizer "não indexe /xyz" é
  anunciar que /xyz existe. Sem sitemap.
- **A raiz `/` devolve 404.** Só respondem os endereços de candidato e o painel.
- O zip da extensão tem o nome derivado da chave, porque carrega o endereço do
  painel dentro dele.

### 8. Nada de dado pessoal em URL

O token de `/r/{token}` é aleatório e aponta para o contato no banco. Telefone,
nome e município nunca vão para a query string.

## Sistema visual

Tokens em `src/app/globals.css`, componentes em `src/components/ui.tsx`.
Ícones: **lucide-react**. Fontes: **Bricolage Grotesque** (display, títulos e
números grandes) e **Manrope** (interface).

**Duas superfícies, tratamento diferente — não unifique:**

- **Interno** (`/painel`, `/gestor`): sempre escuro. É local de trabalho, o dia
  inteiro, muitas vezes num notebook barato com brilho baixo.
- **Público** (`/{slug}` do candidato, `/m`, `/privacidade`): acompanha a preferência
  do aparelho, via a classe `publico` dos layouts `src/app/(publico)/` e
  `src/app/[entrada]/(candidato)/`. Quem abre
  é o eleitor, quase sempre em modo claro, e página clara lê como documento
  oficial.

**Regras que o sistema pressupõe:**

- Lima (`--acento`) é acento E sinal positivo. Não crie um segundo verde.
  No tema claro ela vira oliva sozinha — lima pura sobre branco não tem
  contraste.
- Quente é âmbar, fria é azul-gelo. A cor faz parte da regra de negócio: as
  duas filas nunca se misturam na tela.
- Vidro fosco (`<Vidro>`) só onde existe conteúdo passando por trás — barra
  superior e sobreposições. Vidro em todo card é a versão genérica do efeito.
- Nada de classe Tailwind montada por interpolação (`text-${cor}`): a varredura
  do Tailwind só enxerga nomes literais, e a classe não chega a existir no CSS.
  Use mapa estático.

## Convenções

- Código, comentários, nomes de tabela e UI em **português**.
- Nomes de coluna em `snake_case`; TypeScript em `camelCase`.
- `telefone_e164` é **só dígitos, sem `+`**: `"5569981234567"`. É o que a URL
  `web.whatsapp.com/send?phone=` espera.
- `chave_dedup` é `DDD + 8 dígitos finais` (sem o nono): `"6981234567"`.
  É a identidade da pessoa no sistema e tem `UNIQUE INDEX`.

## Comandos

```bash
npm run dev          # servidor de desenvolvimento
npm run test:tudo    # typecheck + unitários + tipos + banco — antes de commitar
npm test             # só os unitários (rápido)
npm run test:banco   # travas, automações e concorrência, contra o banco
npm run tipos        # confere src/lib/tipos-banco.ts contra as colunas reais
npm run build
```

Migrations: `supabase db push --db-url "$SUPABASE_DB_URL"` contra o projeto
remoto. Não há stack local — esta máquina não tem Docker, e por isso
`supabase gen types` também não roda: **os tipos de `src/lib/tipos-banco.ts`
são mantidos à mão.** Depois de qualquer migration, rode `npm run tipos`, que
falha se alguma coluna ficou sem tipo.

## Infraestrutura

**Não usar a org Supabase `Setup` nem o time Vercel `Agencia Setup`.** Este
projeto roda em contas próprias. Repo: `gabrielmetranvemser/painelgerenciamento`.

---

Regras específicas desta versão do Next.js: @AGENTS.md
