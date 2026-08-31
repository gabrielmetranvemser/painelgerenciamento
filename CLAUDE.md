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
| `src/lib/mensagem.ts` | o editor deixa de APONTAR o que falta no texto → o gestor escolhe sem saber o que está abrindo mão (as regras avisam, não travam: só texto quebrado impede salvar) |
| `src/lib/importacao.ts` | dedup e casamento de município da planilha |
| `pegar_proximo_contato` | dois atendentes pegam o mesmo contato, ou um contato cai para quem não atende aquela lista |
| `rampa_do_chip` | a rampa só vale enquanto `chips.status = 'aquecendo'`. Aplicá-la sempre faz o teto do gestor virar letra morta (`least(rampa, config)`), e ele mexe no campo achando que não salva |
| `preparar_mensagem` | a variação congela por contato. Congelar cedo demais faz texto desativado continuar saindo; congelar de menos reescreve o histórico do que já foi enviado |
| `etapa_de_abordagem` | quem espera o intervalo. Hoje é só `abertura`; incluir os passos seguintes faz o atendente sumir no meio da própria conversa |
| `importar_contatos` | reimportar MOVE a pessoa e preserva o histórico. Quem pediu saída, quem está na mão de alguém e quem teve o telefone apagado não podem ser tocados |
| `pular_intervalo` | um pulo libera UMA abordagem, consumida em `registrar_abertura`. Se liberar mais de uma, "pular o intervalo" vira "desligar o intervalo" |
| `apagar_lista` | apagar a linha da lista sozinha joga os contatos dela na fila de TODO mundo (`lista_id is null` = "cadastrou-se sozinho"). Lista com gente já abordada não se apaga: ali há histórico e procedência |
| `alternar_grupo` | o grupo ESCREVE em `listas.ativa`, e `pausada_pelo_grupo` é o que impede religar de ressuscitar lista que o gestor pausou à mão |

### 2. Toda trava é validada no SERVIDOR

Teto diário, janela de horário, intervalo mínimo, dia bloqueado, termo aceito,
lista de bloqueio: tudo dentro de RPC `security definer` no Postgres. O frontend
só reflete o que o servidor respondeu. Frontend se burla abrindo o DevTools.

**Mas nem toda trava recusa.** Duas naturezas diferentes, e não se misturam:

| Recusa sempre | Por quê |
|---|---|
| `contato_bloqueado` | mensagem depois do pedido de saída é multa POR MENSAGEM |
| `dia_bloqueado` | falar com eleitor no dia da eleição é regra eleitoral |
| `termo_nao_aceito` | sem aceite datado não há defesa numa denúncia |
| `sem_candidato` | a permissão sairia sem dizer de quem é o material |
| `fora_de_horario` | a janela é do gestor; mexer nela é mexer no campo dele |
| `intervalo` | é o espaçamento que o antispam mais olha |

| Avisa e deixa passar | Por quê |
|---|---|
| `teto_atingido` | risco de OPERAÇÃO, não de lei: no pior caso o número cai e a campanha troca pelo reserva. Quem corre o risco decide — `config.teto_bloqueia` devolve a trava se o gestor quiser |
| `intervalo` | continua recusando por padrão, mas o atendente pode PULAR — um pulo por vez, dois cliques, com aviso que endurece a cada repetição e alerta ao gestor do terceiro em diante. Ver `pular_intervalo` |

A regra geral: **risco jurídico recusa, risco operacional avisa.** É a mesma
divisão que `validarModelo` já usava para os textos.

### 3. Atendente não escreve em `contatos` pelo RLS

`SELECT` só nas próprias linhas; `UPDATE`/`INSERT`/`DELETE` negados. Toda mutação
passa por RPC (`pegar_proximo_contato`, `registrar_abertura`,
`registrar_resultado`). Sem isso um atendente se auto-atribui a base inteira.

Nas policies, usar `public.is_gestor()` (função `stable security definer`) e
`(select auth.uid())` — consultar `usuarios` direto dentro da policy causa
recursão infinita, e `auth.uid()` sem o `select` mata a performance.

### 3.1 Server Component só importa COMPONENTE de arquivo `'use client'`

Tudo que um módulo `'use client'` exporta chega ao servidor como **referência
para o cliente**, não como valor. Para componente é assim de propósito; para uma
constante, não — o array vira um objeto que não é array, e `.some` deixa de
existir. Foi assim que `RECORTES.some is not a function` derrubou a tela de
Contatos em produção: typecheck aprova, `next build` compila, e o erro só
aparece quando alguém abre a página.

Constante, função auxiliar e tabela de dados moram em arquivo neutro (ex.:
`gestor/contatos/recortes.ts`), que os dois lados importam. Tipo pode ficar em
qualquer lugar — tipo some na compilação. `npm run fronteira` confere.

### 3.2 A conversa tem quatro passos, e só o primeiro espera

`abertura` → `minha_escolha` → `permissao` → `material`. Quem chega sem aviso é
a **abertura**, e é a única etapa que respeita o intervalo entre abordagens
(`etapa_de_abordagem`). O resto é conversa com quem já respondeu.

O teto diário não muda: conta **pessoas distintas por número por dia**, não
mensagens. Falar com alguém em quatro passos gasta uma conversa, não quatro.

A `permissao` continua sendo onde o consentimento CONGELA — é no envio dela que
`contato_candidato` grava quais candidatos foram declarados àquela pessoa. Por
isso ela é a única dos três que exige `{{candidatos}}` e `{{origem}}`.

Qual passo falta para cada contato sai de `contato_json(...)->'passos'`, no
servidor. A tela nunca adivinha: o mesmo contato volta pela fila, é escolhido a
dedo ou é reaberto por "Meus contatos" dias depois, e repetir uma mensagem que a
pessoa já recebeu é o erro mais caro desta tela.

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
npm run fronteira    # Server Component importando valor de arquivo 'use client'
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
