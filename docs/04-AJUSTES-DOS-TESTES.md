# Ajustes vindos dos testes de 27–28/08/2026

> **Estado: entregue e no ar em 28/08/2026.** Onze migrations aplicadas,
> `npm run test:tudo` verde, `npm run lint` limpo, `next build` compilando.
> Dois arquivos de teste novos (`17_chapa_e_desfechos`, `18_cadastros_do_gestor`)
> somam 40 asserções às que já existiam.
>
> O que ficou de fora, e por quê, está em **Pendências** no fim.

**Documento vivo.** Cada item é uma entrega fechada: uma migration (quando
mexe no banco), a tela, o texto e o teste. Marcar o `[x]` só quando
`npm run test:tudo` passar com o item dentro.

Ordem proposta: **Bloco 0 primeiro** — são dois defeitos que já queimaram
contatos reais de ontem, e um deles é a explicação do outro.

---

## Bloco 0 · Defeitos confirmados no banco de produção

### 0.1 — A chapa do atendente é invisível para o gestor

**Sintoma relatado:** *"o sistema não está salvando (visualmente) o candidato
que o atendente está atrelado."*

**Diagnóstico (confirmado contra o banco):** está salvando. A tela é que não
consegue ler.

`atendente_candidatos` tem **duas** chaves estrangeiras para `candidatos`:

```
atendente_candidatos_candidato_id_fkey            (candidato_id) → candidatos(id)
atendente_candidatos_candidato_id_cargo_vaga_fkey (candidato_id, cargo, vaga) → candidatos(id, cargo, vaga)
```

A segunda existe de propósito (é ela que sustenta o `unique (atendente_id,
cargo, vaga)` — a regra "um candidato por cargo"). Mas com duas FKs para a
mesma tabela, o PostgREST se recusa a adivinhar qual usar:

```
PGRST201 — Could not embed because more than one relationship was found
           for 'atendente_candidatos' and 'candidatos'
```

Conferido com `curl` direto na API do projeto. Os dois pontos que fazem esse
`select` descartam o erro e seguem com `data = null`:

- [`gestor/atendentes/page.tsx:22`](../src/app/[entrada]/(interno)/gestor/atendentes/page.tsx) —
  `chapas` sai vazio para **todo mundo**; a tela mostra "Sem candidato" para
  todos os atendentes, inclusive os que têm chapa.
- [`gestor/atendentes/chapa.ts:40`](../src/app/[entrada]/(interno)/gestor/atendentes/chapa.ts) —
  a checagem "já existe alguém neste cargo" nunca dispara. Quando o gestor
  tenta atribuir de novo (porque a tela diz que não tem ninguém), o `insert`
  bate no `unique` do banco e o erro que aparece é o texto cru do Postgres.

**Correção:** desambiguar o embed pelo nome da FK simples, e parar de engolir o
erro.

```ts
.select('atendente_id, candidato_id, cargo, vaga, principal, candidatos!atendente_candidatos_candidato_id_fkey(nome_urna, numero)')
```

- [x] Corrigir o embed em `gestor/atendentes/page.tsx`
- [x] Corrigir o embed em `gestor/atendentes/chapa.ts`
- [x] Fazer os dois **falharem alto**: hoje `const { data }` sem olhar `error`
      transforma um erro de API em tela vazia silenciosa. Ler o `error` e
      mostrar aviso.
- [x] Varrer o resto do código atrás do mesmo padrão (`data ?? []` sobre um
      `select` com embed) — hoje só estes dois são ambíguos, mas o silêncio é
      geral
- [ ] Teste que garante que a leitura da chapa devolve linha quando existe
      atribuição — **não feito**: o defeito é do PostgREST (embed ambíguo), e
      um teste SQL não o alcança. Foi conferido à mão com `curl` contra a API,
      antes e depois. Um teste de verdade aqui exigiria bater na API HTTP.

---

### 0.2 — Permissão enviada sem chapa congela um consentimento vazio

**Sintoma relatado:** *"Usuários Roberta, Julia e Eduardo não aparece a opção
de enviar material, independente do resultado do contato. No sistema fala que
precisa atrelar o candidato, mas já está atrelado."*

**Diagnóstico (confirmado contra o banco):**

| atendente | abordados | com candidato declarado | chapa criada em | permissões enviadas |
|---|---|---|---|---|
| Roberta | 4 | **0** | 20:45 | 20:10 – 20:37 |
| Maria | 4 | **0** | 20:29 | 20:06 – 20:14 |
| Júlia | 2 | 1 | 20:29 | 20:07 – 20:36 |
| Thais | 3 | **0** | *nenhuma* | 20:08 – 20:47 |
| Vitor | 4 | 4 | 17:59 | a partir de 18:13 |

O `registrar_abertura` congela o consentimento no instante da permissão:
copia a chapa do atendente para `contato_candidato`. Se a chapa estava vazia
naquele instante, a linha nasce vazia — e **nada depois disso a preenche**.
Atrelar o candidato às 20:45 não alcança quem foi abordado às 20:10.

Vitor, que já tinha chapa antes de começar, está com 4 de 4. É a prova do
mecanismo.

E o 0.1 é a causa do 0.2: o gestor atrelou os candidatos tarde **porque a tela
dizia que não tinha ninguém atrelado**.

Um agravante: o modelo ativo da permissão tem `{{candidatos}}`, e com a chapa
vazia ele renderizou vazio. As mensagens saíram assim:

> "Boa tarde, Leticia! Tudo bem? Aqui é Roberta. Tô ajudando **nessa
> eleição**, e um apoiador me passou seu contato. Posso te mandar o material
> aqui? […]"

Ou seja: 11 pessoas autorizaram "o material" sem que ninguém dissesse de quem.

**Correção em duas frentes.**

*(a) Fechar a porta — impedir que aconteça de novo:*

- [x] `preparar_mensagem` recusa a etapa `permissao` quando
      `chapa_do_atendente(uid)` vier vazia. Motivo novo: `sem_chapa`
- [x] Frase em `MOTIVO_ENVIO` (atendimento.tsx) e em `MOTIVO` (perfil.tsx):
      *"Você ainda não tem candidato atribuído. Fale com o gestor antes de
      abrir qualquer conversa — a mensagem sairia sem dizer de quem é o
      material."*
- [x] O mesmo bloqueio em `fila_status`: novo motivo `sem_candidato`, para o
      atendente descobrir na tela de espera e não com o contato na mão
- [x] Contador no menu do gestor — igual ao `v_atendentes_sem_lista` que já
      existe — para **atendente ativo sem chapa**
- [x] Teste de banco: atendente sem chapa não consegue preparar `permissao`

*(b) Recuperar os 11 contatos órfãos — ⚠️ DECISÃO DO GESTOR, não minha:*

O material desses contatos está travado porque eles nunca ouviram um nome. As
saídas possíveis:

1. **Reapresentar (recomendado).** Ferramenta no gestor que declara a chapa
    atual do atendente para esses contatos **e** obriga o atendente a mandar
    antes uma mensagem nova, nomeando o candidato, antes de liberar o material.
    Fica registrado que foi reparo, com data e quem autorizou.
2. **Declarar direto.** Um botão do gestor preenche `contato_candidato` com a
    chapa atual. Rápido, mas entrega material de um candidato a quem nunca
    ouviu o nome dele.
3. **Não recuperar.** Esses 11 seguem como estão.

- [x] **Decidir com o gestor qual caminho** antes de escrever a migration
- [x] Implementar o escolhido

---

## Bloco 1 · Atendente — fila e conversa

### 1.1 — Filtro por resultado em "Meus contatos"

Hoje [`meus-contatos/page.tsx`](../src/app/[entrada]/(interno)/painel/meus-contatos/page.tsx)
traz 300 linhas em ordem de data, sem recorte nenhum.

- [x] Faixa de recortes no mesmo desenho de `gestor/contatos/recortes.ts`
      (arquivo neutro, **sem `'use client'`** — regra 3.1 do CLAUDE.md)
- [x] Filtro na URL (`?resultado=`), não em estado — o servidor é que recorta
- [x] Contagem por recorte, calculada no banco
- [x] Recorte "Aguardando resposta" em destaque: é a pergunta que o atendente
      faz ao abrir a tela
- [x] Paginar, porque com o teto de 30/dia a lista passa de 300 em duas semanas

### 1.2 — Escolher qual contato atender

Hoje só existe "Buscar próximo contato": `pegar_proximo_contato` decide.

- [x] RPC `pegar_contato_especifico(p_contato_id, p_chip_id)` — mesmas travas
      de `pegar_proximo_contato` (teto, horário, intervalo, lista, bloqueio),
      só muda o critério de escolha
- [x] Tela: lista da fila do atendente com nome, cidade, lista e origem, e um
      botão "atender este"
- [x] Manter "Buscar próximo" como caminho padrão — é ele que mantém a ordem
      quente-antes-de-frio e evita que todo mundo escolha os fáceis
- [x] ⚠️ Não expor telefone completo na listagem de escolha
- [x] Teste de concorrência: dois atendentes escolhendo o mesmo contato

### 1.3 — Corrigir nome e número do contato, com rastro

Não existe hoje nenhuma função de edição de contato.

- [x] RPC `corrigir_contato(p_contato_id, p_nome, p_telefone_e164, p_chave_dedup, p_telefone_hmac)`
      — só o dono do contato ou o gestor
- [x] O HMAC é calculado **no servidor** (`src/lib/hmac.ts`), nunca no
      navegador — mesmo caminho de `adicionarContato`
- [x] Trocar o número refaz `chave_dedup`: precisa checar duplicidade e a
      lista de bloqueio antes de gravar
- [x] Tabela `contato_correcoes` (contato, autor, campo, de, para, quando) —
      é rastro de auditoria, gravado por RPC, sem `UPDATE` direto
- [x] Aparece no Histórico do perfil, junto das interações
- [x] ⚠️ Nunca gravar aqui campo livre solto (regra 4 do CLAUDE.md)

### 1.4 — Copiar a mensagem sem abrir o WhatsApp

- [x] Botão "Copiar texto" ao lado de "Abrir conversa no WhatsApp", nas duas
      telas: `painel/atendimento.tsx` e `painel/contatos/[id]/perfil.tsx`
- [x] ⚠️ **Copiar tem de passar pelo mesmo `registrarAbertura`.** Copiar é o
      passo anterior a enviar; se não registrar, o teto, o intervalo e a
      auditoria deixam de ver a mensagem — e a métrica morre exatamente como
      `src/lib/bots.ts` existe para evitar
- [x] Se o servidor recusar, não copia nada — a mesma ordem que
      `abrirConversa()` já usa hoje (comentário longo em atendimento.tsx:~195)
- [x] Confirmação visual ("copiado ✓") e fallback quando
      `navigator.clipboard` não existir
- [x] Manter "Abrir no WhatsApp" como botão principal

### 1.5 — Novos resultados e microdescrições

Hoje são 5: `autorizou`, `pediu_saida`, `invalido`, `quer_ajudar`,
`encaminhado`. Pedidos: **já apoia**, **falar depois**, **não respondeu**,
**não é a pessoa / trocou de número**, **mudou de estado**, **outro (digitar)**.

- [x] Migration: novos valores em `status_contato` — `ja_apoia`,
      `falar_depois`, `nao_e_a_pessoa`, `mudou_de_estado`, `outro`.
      `sem_resposta` já existe e passa a ser marcável pelo atendente
- [x] `registrar_resultado`: a lista branca do topo da função precisa crescer
      junto — hoje ela recusa qualquer coisa fora dos 5
- [x] **"Falar depois" agenda**: grava `adiado_ate` e devolve o contato ao
      próprio atendente depois do prazo, em vez de fechar a conversa
- [x] **"Não respondeu"** convive com o botão "Ainda não respondeu — buscar
      próximo" que já existe; decidir se o botão passa a marcar `sem_resposta`
      ou se continuam sendo coisas diferentes (aberto ≠ encerrado)
- [x] ⚠️ **"Outro (digitar)" é o item de maior risco do documento.**
      `encaminhamento` é hoje o **único** campo de texto livre do sistema, e a
      migration 350000 restringiu ele a "Encaminhar" justamente porque é o
      único lugar onde caberia, por engano, uma anotação de preferência de voto
      (regra 4). Se entrar, entra com: aviso na tela, limite de caracteres, e
      liberado só para `encaminhado` e `outro`
- [x] Microdescrição em cada botão — uma linha, na voz de quem lê
- [x] Redesenhar a grade: 10 botões não cabem em `grid-cols-3`. Proposta:
      5 desfechos frequentes + "Outros desfechos" que expande
- [x] Atalhos de teclado 1–5 continuam nos 5 primeiros (o `useEffect` de
      atalhos indexa `RESULTADOS` direto — vai apontar para o botão errado se
      a ordem mudar sem cuidado)
- [x] Propagar o novo conjunto por: `RESULTADOS` em `tipos-banco.ts`,
      `ROTULO_RESULTADO` (atendimento.tsx e perfil.tsx), `ROTULO` de
      meus-contatos, `ROTULO_STATUS` do perfil, `recortes.ts` do gestor,
      `contatos_do_gestor`, `v_resumo`, `v_desempenho_atendente`,
      `v_saude_chip`, e o CSV de `api/export`
- [x] ⚠️ `v_saude_chip` calcula `pct_saida` / `pct_invalido` — os novos
      resultados mudam o denominador e podem acender ou apagar farol sem que
      nada tenha mudado no chip. Revisar antes de subir

### 1.6 — Avisar de duplicado / já atendido antes de começar

Dois pedidos que são o mesmo problema: no cadastro manual e no início do
atendimento.

Hoje `adicionar_contato` já recusa com `ja_e_de_outro_atendente` — mas só
**depois** de o atendente preencher tudo e clicar em cadastrar.

- [x] RPC `consultar_telefone(p_telefone_hmac)` que devolve o mínimo:
      `existe`, `status`, `primeiro_nome_do_atendente`, `abordado_em`.
      **Nunca** devolve o cadastro inteiro
- [x] ⚠️ Essa RPC é uma porta de consulta de telefone arbitrário. Restringir a
      atendente ativo com termo aceito, e registrar as consultas
- [x] O HMAC vai calculado do servidor (a chave não chega ao navegador)
- [x] Em `novo-contato.tsx`: consulta ao sair do campo de telefone, com aviso
      antes do botão — *"Esse número já está com Fulano desde ontem"*
- [x] Contato duplicado por **nome parecido com número diferente**: mostrar no
      cartão de atendimento quando houver homônimo já abordado na mesma cidade

---

## Bloco 2 · Gestor — cadastros

### 2.1 — Editar o e-mail do atendente

O e-mail mora em `auth.users`; a tela já **mostra** (via `emailsDasContas`),
mas não deixa trocar.

- [x] Ação `trocarEmail(id, email)` com `auth.admin.updateUserById(id, { email, email_confirm: true })`
- [x] Mesmo desenho do lápis que já existe no nome (`Nome` em `lista.tsx`)
- [x] Tratar "já existe conta com esse e-mail" em português
- [x] Avisar que a pessoa passa a entrar pelo e-mail novo **na hora** — quem
      estiver logado não cai, mas o login antigo para de funcionar

### 2.2 — Copiar a senha sem redefinir

⚠️ **Não é possível ler a senha de volta, e não vai passar a ser.** O Supabase
guarda hash; o sistema nunca guardou senha em lugar nenhum (é o que o próprio
aviso da tela promete). Guardar para poder copiar seria trocar uma
inconveniência por um vazamento.

O que existe de real aqui é um buraco menor e concreto: quando o gestor clica
em **"Nova senha"**, o aviso mostra a senha mas **não tem botão de copiar** —
o "copiar recado pronto para o WhatsApp" só existe no fluxo de criação.

- [x] Botão "copiar recado pronto" também no aviso de senha redefinida, com o
      mesmo texto (e-mail + senha + link de instalação)
- [x] Botão "copiar e-mail" na linha de cada atendente
- [x] Trocar o texto para explicar por que não dá para ver a senha atual

### 2.3 — Gestor cria modelos de mensagem próprios

Hoje as 7 etapas são fixas (`etapa_msg`) e o gestor só edita as **variações**
de cada uma. O pedido é criar mensagens novas, que apareçam em "Mandar outra
mensagem" no perfil do contato.

- [x] Tabela `modelos_livres` (id, nome, dica, texto, ativo, ordem,
      candidato_id opcional) — **não** mexer no enum `etapa_msg`, que é a
      espinha da auditoria e das travas
- [x] `preparar_mensagem` aceita `p_modelo_livre_id`; grava a interação numa
      etapa `livre` (valor novo do enum) com o id do modelo junto
- [x] Passam pelas mesmas travas: bloqueio, teto, horário, intervalo, contato
      é seu
- [x] Passam por `validarModelo` — o editor precisa apontar variável
      inexistente, senão `{{nome_do_candidato}}` vai cru para o eleitor
- [x] Decidir se são etapa de **abordagem** (contam intervalo) ou de
      **resposta** (não contam) — hoje `ETAPAS_DE_ABORDAGEM` é
      `permissao, material, convite_grupo`. Proposta: campo por modelo
- [x] Tela do gestor em Mensagens, com prévia igual à das etapas fixas
- [x] Aparecem no `MENSAGENS` do perfil do atendente

### 2.4 — Gestor cadastra os tipos de material solicitável

Os itens do kit estão escritos à mão em **cinco** lugares:

- `src/app/[entrada]/(candidato)/acoes.ts:12` — `ITENS_VALIDOS` (a validação)
- `src/app/[entrada]/(candidato)/formulario.tsx:12`
- `src/components/novo-contato.tsx:30`
- `src/app/[entrada]/(interno)/painel/contatos/[id]/perfil.tsx:65`
- `src/app/[entrada]/(interno)/gestor/entregas/lista.tsx:12` (o rótulo)

- [x] Tabela `itens_kit` (chave, rótulo, ativo, ordem, pede_tamanho)
- [x] `pede_tamanho` substitui o `if (itens.includes('camiseta'))` que hoje
      está escrito à mão em três telas
- [x] Tela do gestor (dentro de Entregas ou de Configuração)
- [x] `captacoes.itens` é `text[]` — dado antigo com chave desativada precisa
      continuar legível no relatório
- [x] A validação do formulário público passa a ler a tabela
- [x] Um teste que falha se aparecer chave de item nova escrita à mão no código

### 2.5 — Comitês e a distância até a pessoa

- [x] Tabela `comites` (nome, candidato_id, município, CEP, rua, número,
      bairro, latitude, longitude, ativo, horário de funcionamento)
- [x] Atrelar a candidato — um comitê pode servir mais de um (tabela de
      ligação, ou `candidato_id` nulo = vale para todos)
- [x] ⚠️ **Coordenada: o ViaCEP não devolve.** `src/lib/busca-cep.ts` só traz
      rua/bairro/cidade/UF. Caminho proposto: BrasilAPI (`/api/cep/v2/`, que
      devolve `location.coordinates`), no servidor, com cache longo — mesmo
      desenho e mesmos motivos do arquivo atual. O gestor também pode colar
      lat/lon do Google Maps na mão, que é o caminho confiável
- [x] Haversine em `src/lib/distancia.ts`, com teste
- [x] ⚠️ Escrever **"em linha reta"** na tela. Distância de estrada é outra
      coisa, e em Rondônia a diferença é grande
- [x] Sem coordenada dos dois lados, cair para o município: *"Tem um comitê em
      Ji-Paraná"* — melhor do que número errado
- [x] Mostrar na tela pública de solicitação (`(candidato)/formulario.tsx`),
      depois do CEP
- [x] Mostrar na visão do atendente (perfil do contato, junto do pedido de kit)
- [x] ⚠️ O CEP da pessoa não pode ir para query string nem para terceiro pelo
      navegador (regra 8 + o cabeçalho de `busca-cep.ts`) — a consulta sai do
      nosso servidor

---

## Bloco 3 · Ajustes de tela

### 3.1 — "Mandar material" carrega a mensagem na própria seção

Em [`perfil.tsx`](../src/app/[entrada]/(interno)/painel/contatos/[id]/perfil.tsx),
`mensagem` é um estado só, e o bloco que mostra o texto está **dentro** do
cartão "Mandar outra mensagem". Clicar em "Mandar material" no cartão de cima
faz o texto aparecer num cartão lá embaixo — parece que o botão não fez nada.

- [x] Extrair o bloco de prévia + "Abrir conversa" para um componente
- [x] Renderizar dentro do cartão que originou a mensagem
- [x] Mesmo tratamento para "Convidar pro canal"
- [x] Rolar até a prévia quando ela nascer fora da vista

### 3.2 — O que é "Encaminhar", e onde o gestor vê

**Resposta à pergunta.** "Encaminhar" é o desfecho de quando a pessoa pede
algo que a campanha não pode prometer — emprego, dinheiro, uma vaga. O
atendente escreve em uma linha o que foi pedido, o sistema manda a mensagem de
`encaminhamento` ("Isso eu não posso prometer, e a lei não permite. O que posso
é levar sua pergunta pra equipe") e grava o texto em `contatos.encaminhamento`.

**E hoje ele só chega ao gestor pelo CSV.** Conferido: `encaminhamento`
aparece em `api/export/[relatorio]/route.ts:117` e em lugar nenhum da tela.
Não há recorte de "Encaminhados" em `recortes.ts`, e a tabela de contatos não
mostra a coluna. Na prática, ninguém encaminha nada — o texto morre no banco.

- [x] Recorte "Encaminhados" em `gestor/contatos/recortes.ts` + o `case`
      correspondente em `contatos_do_gestor` (o comentário do arquivo avisa:
      chave sem par no banco cai calada em "todos")
- [x] Mostrar o texto do encaminhamento na linha da tabela
- [x] Marcar como tratado, com quem tratou e quando — senão a lista só cresce
- [x] Contador no menu do gestor, como o de Suporte
- [x] Explicar o desfecho na microdescrição do botão (item 1.5)

---

## Decisões que dependem do gestor

1. **Os 11 contatos órfãos do item 0.2** — reapresentar, declarar direto, ou
   deixar como estão.
2. **"Outro (digitar)" no resultado (1.5)** — abre o segundo campo de texto
   livre do sistema. Vale o risco?
3. **Modelos livres contam intervalo? (2.3)** — se contarem, o atendente
   espera para responder alguém que acabou de escrever; se não contarem, viram
   a porta de fuga da trava de ritmo.
4. **Comitê por candidato ou geral? (2.5)**

## Antes de cada commit

```bash
npm run test:tudo
```

Depois de qualquer migration, `npm run tipos` — ele falha se alguma coluna
nova ficou sem tipo em `src/lib/tipos-banco.ts`, que é mantido à mão.


---

## Pendências

### Verificação visual das telas

Tudo foi conferido por `typecheck`, `lint`, `next build`, 297 testes unitários e
a suíte de banco inteira — inclusive a idempotência de `registrar_abertura`, que
é o que o índice único novo poderia ter quebrado.

O que **não** foi feito é abrir as telas logado e olhar. Vale passar os olhos em:

- Gestor → Atendentes: a chapa agora aparece; o aviso de reparo aparece para
  Roberta, Maria e Júlia
- Painel → o cartão de desfechos, que passou de 5 para 11 botões
- Perfil do contato: a prévia da mensagem agora nasce dentro do cartão que a
  gerou
- Gestor → Candidatos → um candidato: o cartão de comitês
- Gestor → Entregas: o cadastro de itens no rodapé
- Gestor → Mensagens: o bloco "Suas mensagens" no rodapé

### Efeito imediato da trava de chapa

`fila_status` agora recusa com `sem_candidato` quem não tem candidato
atribuído. **Thais e "Lucas atendente" estão nesse estado** e não recebem
contato até o gestor montar a chapa deles. É o comportamento correto — sem
chapa a primeira mensagem sai sem dizer de quem é o material —, mas é uma
mudança que aparece no primeiro turno.

O menu do gestor mostra o número em vermelho, em Atendentes.

### Os 9 contatos órfãos

Roberta (4), Maria (4) e Júlia (1) têm contatos abordados antes de a chapa
existir. O botão de reparo está na tela de Atendentes, com confirmação em dois
passos e o texto explicando o que ele faz.

Thais tem 3 contatos órfãos que **só poderão ser reparados depois** de ela
receber uma chapa — a própria tela diz isso.

### Uma armadilha do Postgres que vale lembrar

`create or replace function` só substitui quando a lista de argumentos é
idêntica. Acrescentar um parâmetro, mesmo com `default`, cria uma SOBRECARGA e
deixa a antiga de pé — e aí toda chamada antiga vira
`function ... is not unique`. O `db push` passa; quebra em produção.

Aconteceu aqui, e a migration `derrubar_sobrecargas` é a correção. **Acrescentou
parâmetro? Derrube a assinatura antiga na mesma leva.**
