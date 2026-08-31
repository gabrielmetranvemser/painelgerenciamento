# Painel de Gerenciamento de Contatos

**Documento 3 de 3 — Operação, Troca de Janela e Checklists**

> Como o sistema é usado no dia a dia. Serve de base para o manual do atendente, o roteiro do gestor e os checklists de preparação.

---

## 1. Papéis

**Gestor** — cria contas, sobe listas, escreve textos, vê relatórios. Não conversa com eleitor.
**Atendente** — recebe contatos da fila, conversa pelo WhatsApp dele, marca resultado. Vê só o que é dele.

O gestor cria as contas dos atendentes de dentro do painel. Ninguém se cadastra sozinho.

---

## 2. Configuração das máquinas (a parte da troca de janela)

Cada atendente trabalha **no computador**, com dois números de WhatsApp: um **ativo** (faz o atendimento) e um **reserva** (fica pronto para substituir se o ativo cair).

### 2.1 Por que dois perfis do Chrome

O WhatsApp Web aceita **uma conta por perfil de navegador**. Com um perfil só, trocar de número exige sair e escanear o QR de novo toda vez — inviável.

Com **dois perfis**, cada número fica logado permanentemente. Trocar vira mudar de janela.

### 2.2 Montagem (uma vez, ~10 min por máquina)

1. No Chrome, clicar no ícone de perfil (canto superior direito) → **Adicionar**.
2. Criar dois perfis: **Chip A** e **Chip B**.
3. Em cada perfil, abrir o WhatsApp Web e escanear o QR do número correspondente. Deixar logado.

Cada perfil é isolado: cookies e sessões próprios, sem conflito. Os dois ficam pareados ao mesmo tempo.

### 2.3 Atalhos que automatizam a troca

Criar dois atalhos na área de trabalho de cada máquina:

**Atendimento Chip A**
```
chrome.exe --profile-directory="Profile 1"
  https://painel.SEUDOMINIO.com.br
  https://web.whatsapp.com
```

**Atendimento Chip B**
```
chrome.exe --profile-directory="Profile 2"
  https://painel.SEUDOMINIO.com.br
  https://web.whatsapp.com
```

Duplo clique abre a janela certa, com o painel e o WhatsApp Web já carregados, no número certo. Trocar de número é clicar no outro ícone. **O atendente nunca mais vê QR code.**

> Limitação honesta: o sistema não consegue forçar o Chrome a trocar de perfil sozinho — isso é do navegador. Mas com o atalho, a troca vira um clique.

### 2.4 Reserva x Dividido

- **Modelo reserva (recomendado):** Chip A faz todo o atendimento; Chip B fica pareado e aquecido, com uso pessoal normal, **sem tocar na lista**. Se o A cair, o B entra no mesmo dia, já saudável. O atendente só usa o A; o B é o pneu do porta-malas.
- **Modelo dividido:** os dois trabalham (metade das conversas em cada). Só compensa se o gestor subir o teto para 50–60/dia. Com 30/dia, não vale a complexidade.

**Começar no reserva.** Migrar para dividido depois, se a operação estiver saudável e o gestor quiser volume. O sistema já suporta os dois (teto é contado por chip).

### 2.5 O que o sistema faz na troca

- registra qual chip falou com cada contato
- conta o teto **por chip**
- quando o gestor marca um chip como caído, avisa o atendente na próxima entrada: *"Seu Chip A foi desativado. Abra o atalho do Chip B."*
- contatos que ficaram na conversa do chip morto viram `perdido` e não voltam para a fila

### 2.6 O detalhe que dói quando acontece

Quando um chip cai, **as conversas dele morrem junto**. As pessoas que aquele número abordou vão responder para um número que não existe mais, e ninguém vê. Não há recuperação.

Por isso o objetivo do primeiro contato é **levar a pessoa ao link e ao canal**, não convencer na conversa. Quem entrou no canal sobrevive à morte do chip. Quem ficou só na conversa, some junto.

---

## 3. Preparação dos números (antes de qualquer lista)

Em cada celular, para **os dois** números:

- instalar, definir **foto própria** e **só o primeiro nome** como nome de exibição — e não mudar mais
- ativar a **verificação em duas etapas** (senão o número pode ser sequestrado)
- durante ~10 dias, uso normal: conversar com família, entrar em grupos, **receber** mensagens (receber vale mais que enviar)
- WhatsApp comum, **não** Business (Business dá cara institucional e enfraquece o "pessoa natural conversando")
- o celular precisa entrar online de tempos em tempos, senão o WhatsApp Web desconecta sozinho

Um celular pode ter **duas contas** (dois chips ou eSIM), então ninguém precisa carregar dois aparelhos.

### Perfil do WhatsApp do atendente (entra no termo)
- só o primeiro nome como exibição
- foto própria
- **proibido**: foto do candidato, de apoiador, santinho ou material de campanha no perfil

---

## 4. O dia do atendente (passo a passo)

> **A conversa tem quatro passos, e o painel conduz um de cada vez:**
> **1. Abertura** — só o "oi", e espera responder. É a única mensagem que
> respeita o intervalo entre abordagens.
> **2. Minha escolha** — o atendente conta, na primeira pessoa, em quem decidiu
> votar e por quê. O motivo específico é dele; o roteiro da lateral ensina como
> escrever.
> **3. Permissão** — declara a chapa inteira e pede para mandar o material. É
> aqui que o consentimento fica gravado.
> **4. Material** — só depois do "pode".
>
> Os desfechos ficam disponíveis desde o primeiro passo: quem responde "não
> quero" logo no "oi" é marcado ali mesmo, sem receber mais duas mensagens.
> Se a conversa parar no meio, ela continua por **Meus contatos**, que mostra
> quais passos faltam.
>
> **A sequência é o caminho comum, não uma obrigação.** Ao lado do título da
> mensagem tem um "› pular etapa": abre os três passos e você vai direto ao que
> faz sentido. Quem já conhece a pessoa não precisa mandar "oi" antes de contar
> a escolha. Os já enviados aparecem com ✓ e continuam clicáveis — reenviar não
> conta duas vezes no teto.

1. Abre o atalho do Chip A. Painel e WhatsApp Web já carregam.
2. Login. Na primeira vez, lê e aceita o termo (fica gravado com data/hora). Sem aceite, não entra na fila.
3. Painel: *"Bom dia, Lucas. Hoje você tem 30 conversas. Comece pelos 6 cadastros novos do site."*
4. Aparece o contato: nome, cidade, origem.
5. Mensagem já escrita, com o nome preenchido.
6. Clica em **"Abrir conversa"** → o chat abre com o texto pronto.
7. Revisa, ajusta se quiser, envia. Conversa normalmente.
8. Volta ao painel e marca o resultado.
9. Se **Autorizou**, o painel entrega a próxima mensagem (link do material + convite do canal) e libera o campo Município.
10. O próximo contato carrega sozinho.

### Botões de resultado
**Autorizou · Pediu saída · Número inválido · Quer ajudar · Encaminhar** (campo curto). Auxiliar: **Quem passou meu número**.

Cada resultado carrega a mensagem seguinte:
- Autorizou → Material
- Pediu saída → Saída (e entra no bloqueio na hora)
- Quer ajudar → Quer ajudar
- Encaminhar → Encaminhamento
- Número inválido → próximo contato

### O que o painel não deixa
- trabalhar fora do horário
- falar com quem pediu saída
- falar com quem outro atendente já atende
- falar com alguém no dia da eleição

### O que o painel avisa, e deixa você decidir
- **passar do teto do dia** — aviso vermelho permanente, e segue funcionando
  (o gestor pode voltar a travar em Configuração)
- **pular o intervalo** — botão na tela de espera, **dois cliques**, com aviso
  que fica mais duro a cada vez que aquele número pula no mesmo dia. Do terceiro
  em diante o gestor recebe alerta. Um clique libera UMA conversa, não o resto
  do dia.

### Todo desfecho pede dois cliques
"Autorizou", "Pediu saída", "Número inválido" — todos. O primeiro clique arma o
botão e ele muda de cara; o segundo grava. Clicar noutro desfecho desarma o
primeiro. É um clique a mais por conversa contra um desfecho errado que tira a
pessoa da fila sem ninguém perceber.

### Cabeçalho fixo da tela (sugestão de texto)
> Você fala com essas pessoas pelo seu WhatsApp, uma de cada vez. Escreva como você fala (se não usa "tô", troque por "estou"). Cinco regras: (1) primeiro só o pedido de permissão; (2) material só depois do "pode"; (3) uma tentativa por pessoa, nunca insista; (4) "não" é não: marque Pediu saída e agradeça; (5) hoje você tem até [30] conversas, das 9h às 20h. Não prometa nada a ninguém e não discuta política com quem responde mal.

---

## 5. Botão de socorro: "Meu WhatsApp está estranho"

Colocar na tela do atendente um botão **"Meu WhatsApp está estranho"**.

Serve para quando o WhatsApp começa a pedir confirmação repetida, some por minutos ou trava. Isso é **aviso prévio de queda** — vale mais que qualquer métrica automática, porque o atendente sente antes de o sistema medir.

Ao clicar: o chip vai para status `amarelo`, o gestor é avisado, e o atendente recebe orientação de reduzir o ritmo ou trocar para o Chip B.

---

## 6. Painel "Como agir" (na lateral da tela)

Os 13 casos, cada um com resposta pronta para copiar e qual botão marcar. Enquanto a versão em software não fica pronta, imprimir e deixar do lado do computador.

**Acima dele fica o "Roteiro da conversa"** (`/{chave}/painel/script`), que abre em aba própria — do "oi" até depois da eleição, em 15 blocos, com o texto pronto de cada passo e os nomes da chapa do atendente já preenchidos. Vive em aba separada, e não numa sanfona da lateral, porque quinze blocos abertos numa coluna de 340px empurram o contato para fora da tela justo quando alguém está esperando resposta. Fonte: `src/lib/script-apoio.ts`.

Dois blocos dele — **Material** e **Convite ao canal** — aparecem sem botão de copiar. O link deles é por pessoa e sai do painel; texto colado com link de outro lugar não registra o clique daquele contato, e o clique é a única métrica confiável do projeto.

1. "Pode / manda / sim" → Material → **Autorizou**
2. "Não / não quero / para" → Saída → **Pediu saída**
3. "Quem te passou meu número?" → Quem passou; se preferir sair, caso 2
4. "Já voto em outro" → "Tudo bem, respeito. Vou tirar seu contato da lista." → **Pediu saída** (não anotar em quem vota)
5. "Quem é o candidato / o que defende?" → Material → **Autorizou**
6. "Número errado / não sou eu" → "Desculpa pelo engano, vou tirar da lista." → **Número inválido**
7. Quer ajudar / voluntário / adesivo → Quer ajudar → **Quer ajudar**
8. Pediu emprego, dinheiro, cesta, favor → Encaminhamento, nunca prometer → **Encaminhar**
9. Xingou → não responder, não printar → **Pediu saída**
10. Onde vota / título / horário → link oficial do TSE
11. Não respondeu → nada; automático em 72h
12. Respondeu dias depois → tratar por "Meus contatos"
13. Pediu para entrar no grupo → Convite ao grupo, nunca adicionar na mão → **Enviei convite**

---

## 7. O gestor no dia a dia

### Preparação (uma vez)
- [ ] cadastrar os atendentes (nome + e-mail)
- [ ] escrever/editar os textos das mensagens (o editor aponta o que falta; a decisão é sua)
- [ ] definir teto, horário e o dia bloqueado (eleição)
- [ ] em **Números**, decidir número por número quem ainda precisa aquecer — chip comprado para a campanha fica em *Aquecendo* (5, 8, 12, 18, 25 conversas nos primeiros dias); número que a pessoa já usava no dia a dia vai direto para *Ativo* e segue o teto configurado. Enquanto está aquecendo, o número faz MENOS conversas que o teto, e a tela de Configuração mostra quem é quem.
- [ ] cadastrar o destino dos links (material e canal)
- [ ] subir a lista fria (com "entregue por" + data) e as origens quentes
- [ ] conferir a tela de importação antes de confirmar

### Onde o material aparece para a pessoa

A pergunta chega sempre depois de cadastrar as peças no perfil do candidato:
*"cadastrei santinho, site e canal — e agora, onde isso aparece?"*.

**Não aparece na página pública do candidato.** Lá é onde a pessoa **pede**. O
material chega depois, por outro caminho:

1. **A pessoa pede** — se cadastra na página do candidato, ou já estava numa
   lista importada. Nesse momento ela não recebe nada: a tela só diz que a
   equipe vai falar com ela.
2. **Um atendente chama** — o contato entra na fila de quem atende aquele
   candidato, e a primeira mensagem sai do WhatsApp do atendente, na mão.
3. **Ela autoriza** — o atendente marca "Autorizou" e o botão *Mandar material*
   libera.
4. **Aí sim ela recebe** — um link no WhatsApp, que abre uma página só dela com
   todas as peças ativas daquele candidato, o CNPJ e o botão de sair.

Entre o cadastro da peça e a entrega há uma pessoa, sempre. É isso que mantém a
operação como conversa, e não como disparo.

⚠️ **Não abra o link de um contato para conferir.** O sistema só descarta a
pré-visualização automática do WhatsApp; o gestor abrindo no navegador conta
como clique de verdade e suja a única métrica confiável do projeto. A mesma
explicação está dentro do painel, embaixo do formulário de peças.

### Grupos de lista

Blocos que ligam e desligam junto — a ideia é a de campanhas do Meta. Em Listas,
"Novo grupo", e cada lista escolhe o grupo dela num seletor.

**Desligar o grupo tira todas as listas dele da fila de uma vez**, sem apagar
nada. Ligar de volta devolve ao ar exatamente as que ele desligou: a lista que
você tinha pausado à mão continua pausada, porque não foi o grupo que a parou.

Apagar o grupo não apaga lista nenhuma — só desfaz o vínculo, e devolve ao ar o
que ele tinha desligado.

Os blocos nascem fechados, mostrando quantas listas e quantos contatos estão na
fila por cada um. Lista sem grupo aparece embaixo, solta.

### Apagar uma lista

Em Listas, ao lado de Pausar. Duas regras, e as duas são do banco:

- **Ninguém foi abordado** → a lista some e os contatos dela vão junto. A tela
  diz quantos antes de perguntar "tem certeza?".
- **Alguém já foi abordado** → recusa. Ali há histórico de conversa, e a lista é
  a procedência daquela gente — de quem veio e quando. O caminho é **Pausar**,
  que tira da fila na hora e não perde nada.

⚠️ O bloqueio de quem pediu saída **não** vai junto: ele é por HMAC do telefone
e sobrevive ao apagamento do contato. Se sumisse, o mesmo número voltaria na
próxima importação — e mensagem para quem pediu saída é multa por mensagem.

### Importação
Ao subir a planilha, o sistema mostra antes de importar:
> "10.000 linhas · 8.740 aproveitáveis · 1.190 repetidas · 70 bloqueadas"

Só importa após confirmação. A lista fria **não importa sem o campo "lista entregue por"**.

**Último passo da importação: quem atende.** A planilha entra na base sem dono, e
lista sem dono não vai para fila nenhuma — os contatos ficam guardados, sem
serem chamados. A própria tela de importação pergunta quem vai atender aquela
lista; dá para mudar depois em **Base → Listas**, ou pelo cartão de cada pessoa
em **Equipe → Atendentes**.

Em Listas o gestor ainda renomeia e **pausa** uma lista. Pausada, ela sai da fila
de todo mundo na hora e os contatos continuam no banco, intactos — é o botão
para "essa planilha era ruim" ou "esse bairro fica para depois", sem apagar
nada. Quem já está com um contato dela na mão termina a conversa.

O número em âmbar ao lado de **Atendentes**, no menu, é quanta gente ativa está
sem lista nenhuma. Enquanto ele não for zero, tem atendente sentado com a fila
parada.

### Acompanhamento (todo dia)
- contatos falados x pendentes
- autorizações, saídas, sem resposta
- **cliques no link** (a métrica mais confiável)
- desempenho por atendente
- tudo por município
- exportar CSV quando quiser
- olhar a saúde dos chips (verde/amarelo/pausado) e trocar reserva quando preciso

### Termômetro do chip (o que o gestor observa)
| Sinal | Verde | Amarelo | Vermelho |
|---|---|---|---|
| "Pediu saída" nos últimos 20 | < 15% | 15–30% | > 30% |
| Sem resposta em 24h | < 60% | 60–80% | > 80% |
| "Número inválido" | < 5% | 5–12% | > 12% |
| Clique no link (entre os que autorizaram) | > 50% | 30–50% | < 30% |
| Conversas/hora | < 20 | 20–30 | > 30 |

Vermelho em qualquer eixo → pausar o chip 24–48h e trocar para o reserva.

---

## 8. Textos iniciais dos modelos

> Regras dos textos: sem link e sem emoji na Permissão; sem áudio; no máximo quatro linhas; material como texto/link (nunca "encaminhado").
> Blocos recomendados na Permissão e no Material: `{{candidato}}`+`{{cargo}}` na mesma frase; a menção de como o contato chegou; a frase de parar/apagar.
>
> O editor aponta o que falta em vermelho e explica por quê, mas **não impede salvar** — escreva do jeito que soa de gente. Só texto vazio ou com variável inexistente é recusado, porque sairia quebrado na mão da pessoa.

**Permissão — variação 1**
> {{saudacao}}, {{primeiro_nome}}! Tudo bem? Aqui é {{nome}}. Tô ajudando o(a) {{candidato}} nessa eleição pra {{cargo}}, e um apoiador dele(a) me passou seu contato. Posso te mandar o material aqui? Se não quiser, me fala que eu paro por aqui e apago seu número, tranquilo.

**Permissão — variação 2**
> Oi, {{primeiro_nome}}, {{saudacao}}! Sou {{nome}}. Tô com o(a) {{candidato}} nessa eleição, ele(a) tá concorrendo a {{cargo}}. Um apoiador dele(a) me passou seu contato. Tudo bem se eu te mandar as propostas? Se preferir não receber, é só me dizer que apago seu contato.

**Permissão — variação 3**
> {{saudacao}}, {{primeiro_nome}}, tudo certo? {{nome}} aqui. Tô dando uma força pro(a) {{candidato}}, candidato(a) a {{cargo}}, e um apoiador dele(a) me indicou seu contato. Posso te mostrar o material por aqui? Se não quiser, sem problema, me avisa que apago seu número.

**Permissão — variação 4**
> {{saudacao}}, {{primeiro_nome}}! Aqui é {{nome}}. Tô ajudando o(a) {{candidato}} ({{cargo}}) e um apoiador me passou seu contato. Te mando o material? Se não quiser, me fala que apago seu número e não te chamo mais.

**Permissão — variação 5**
> Oi, {{primeiro_nome}}, {{saudacao}}, tudo bem por aí? Eu sou {{nome}}, tô nessa eleição ajudando o(a) {{candidato}} pra {{cargo}}. Um apoiador dele(a) me passou seu contato. Posso te mandar as propostas aqui no WhatsApp? Se preferir que não, me fala que apago seu contato, de boa.

**Material (após Autorizou)**
> Que bom, {{primeiro_nome}}! Esse é o material do(a) {{candidato}} – {{cargo}} – nº {{numero}}: {{link}}. Só pra eu te mandar as coisas da sua região: você é de qual cidade? Se quiser acompanhar de perto, tem o canal da campanha, entra só se quiser: {{link_grupo}}. E se um dia não quiser mais receber, me avisa que apago seu contato.

**Saída**
> Tranquilo, {{primeiro_nome}}. Já tirei seu número da lista e ele será apagado em até 48h. Obrigado(a) por responder!

**Quem passou meu número**
> Foi um apoiador do(a) {{candidato}} que tem seu contato. Se preferir, apago seu número agora e não te chamo mais.

**Quer ajudar**
> Que ótimo, {{primeiro_nome}}! Posso passar seu contato pra coordenação te chamar?

**Encaminhamento**
> Isso eu não posso prometer, e a lei não permite. O que posso é levar sua pergunta pra equipe, tudo bem?

**Convite ao grupo (quando a pessoa pede)**
> Tem sim! Eu não adiciono ninguém, você entra pelo link, assim fica no seu controle: {{link_grupo}}. Se um dia quiser sair, é só sair.

---

## 9. Termo de uso do atendente (conteúdo mínimo — gestor edita)

- Envio manual pelo meu WhatsApp; nada de robô, extensão de envio ou lista de transmissão.
- Primeiro só peço permissão; material só depois do "pode"; uma tentativa por pessoa.
- Respeito o teto diário e o horário; nada no dia da eleição.
- No perfil, só meu primeiro nome e minha foto; nunca foto do candidato, de apoiador ou de material.
- Não salvo contatos na agenda, não encaminho listas, não coloco ninguém em grupo, não printo conversas.
- Não prometo nada a ninguém (emprego, dinheiro, favor).
- Não anoto em quem a pessoa vota.
- Ao fim da campanha, apago as conversas.
- Os dados são da campanha e sigilosos; uso só para esse atendimento.

> **Ponto que o atendente precisa entender antes de aceitar:** o número que aparece numa eventual denúncia é o dele. O termo protege a campanha. Ele precisa saber disso, e não pode ser remunerado por mensagem enviada.

---

## 10. Landing dos links (o que a pessoa vê)

**Página do link (`/r/{token}`):** registra o clique (data/hora/IP), depois leva ao destino (material ou canal).

**Página de material / canal:** botão "Quero receber", campo cidade (opcional), botão "Entrar no canal", aviso de privacidade, botão "não quero receber" (gera bloqueio).

**Página do kit (`/kit`):** nome, telefone, cidade, endereço, itens (santinho, adesivo, camiseta). Quem envia entra na Fila Quente do dia seguinte, com consentimento gravado.

---

## 11. Checklist de sábado (preparação — sem código)

- [ ] **Comprar os 30 chips** (15 ativos + 15 reservas) e mandar os 15 atendentes começarem o aquecimento **hoje à noite**
- [ ] Ativar verificação em duas etapas em todos
- [ ] Pedir ao Gabriel **o CSV real da lista** (obrigatório antes de codar)
- [ ] Perguntar **a origem da lista** (trava tudo)
- [ ] Pedir **os textos das mensagens** (ou escrever e ele aprova)
- [ ] **Criar o canal do WhatsApp** da campanha
- [ ] **Registrar o domínio** dos links (DNS demora, fazer hoje)
- [ ] Criar projetos Supabase, Vercel e o repositório; convidar o sócio
- [ ] Fechar o schema no papel; escrever o `CLAUDE.md`
- [ ] Combinar com o sócio: turno alternado ou virada, e quem faz o quê
- [ ] Avisar o Gabriel que **segunda é piloto** (2 pessoas, 50 contatos), não largada
- [ ] Pedir nome + e-mail dos 15 atendentes
- [ ] Confirmar se há advogado eleitoral para revisar os textos

---

## 12. Checklist de segunda (piloto)

- [ ] fluxo ponta a ponta testado com 20 contatos de teste no domingo
- [ ] 2 atendentes reais, 50 contatos, chips que já tenham pelo menos alguns dias de uso
- [ ] observar bugs de uso real, taxa de resposta e reação às mensagens
- [ ] ajustar textos com base nas primeiras reações
- [ ] treinar os outros 13

---

## 13. Erros a não cometer (resumo)

- ❌ subir os 15 com 10 mil contatos na segunda → chip novo morre em massa
- ❌ misturar fila quente e fria → desperdiça o lead bom no risco do lead ruim
- ❌ automatizar o envio "só pra ajudar" → vira disparo, perde a defesa jurídica
- ❌ registrar preferência de voto em qualquer campo → dado sensível, vedado
- ❌ importar lista fria sem "entregue por" → sem rastreabilidade, sem defesa
- ❌ usar encurtador público ou o domínio principal da campanha nos links → queima o domínio
- ❌ mudar nome/foto do perfil depois de aquecer → parece conta comprometida
- ❌ vender por preço fechado sem cobrar o acompanhamento mensal → você vira suporte 24h de graça
