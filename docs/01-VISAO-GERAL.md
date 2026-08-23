# Painel de Gerenciamento de Contatos

**Documento 1 de 3 — Visão Geral, Escopo e Estratégia**

> Este é o documento de conceito. Explica o que o sistema é, o que faz, o que **não** faz, e por que cada decisão foi tomada. Serve para alinhar cliente (Gabriel), gestor e time de desenvolvimento antes de qualquer linha de código.
>
> - Documento 2: construção técnica (Vercel, Supabase, banco, extensão).
> - Documento 3: operação (gestor, atendente, troca de janela, checklists).

---

## 1. O que é o sistema, em uma frase

Um painel que organiza o atendimento manual de contatos por WhatsApp: entrega o contato certo para o atendente certo, com o texto pronto, registra o resultado da conversa e faz cumprir as regras de volume, horário e privacidade.

**O sistema não envia mensagem.** Quem conversa é o atendente, pelo WhatsApp Web dele. O sistema é o painel do lado.

---

## 2. Por que NÃO automatizar o envio (a decisão central do projeto)

Essa é a decisão que define tudo. Precisa estar clara para todos.

Existe tecnologia para o servidor mandar mensagem sozinho (conectando ao WhatsApp por trás). Foi descartada de propósito, por três motivos:

1. **Custo.** Rodar envio automático exige servidor dedicado ligado o dia todo, endereços de rede separados por número, e alguém consertando queda toda madrugada. Custa de R$ 3.500 a R$ 5.500/mês. Não cabe no orçamento.

2. **Queda de conta.** Número novo mandando mensagem automática para lista fria é o padrão que o WhatsApp mais pune. Morre em dias.

3. **Risco jurídico.** No momento em que o software dispara, deixa de ser "conversa entre pessoas" e vira "disparo em massa", que é vedado na eleição. As próprias técnicas para disfarçar o disparo viram prova contra a campanha se houver denúncia.

**A escolha do projeto:** o software organiza e mede, o humano conversa. Isso mantém a operação barata, os números vivos por mais tempo e a campanha na posição defensável.

---

## 3. Escala: de 1 a 15 atendentes, mesmo sistema

O sistema nasce multiusuário. Não muda nada entre operar com 1 pessoa ou com 15.

**Papéis:**

- **Gestor** (o Gabriel ou quem ele indicar): cria as contas dos atendentes, sobe as listas, escreve os textos, vê os relatórios. Uma conta de gestor basta; pode ter mais de uma.
- **Atendente**: recebe contatos da fila, conversa, marca resultado. Cada um vê só o que é dele.

O gestor cria as contas dos atendentes de dentro do painel. Ninguém se cadastra sozinho.

---

## 4. As duas origens de contato (tratadas de forma diferente)

O sistema trabalha com dois tipos de contato, e **nunca os mistura na mesma fila**:

### Fila Quente — quem se cadastrou sozinho
- veio do site, do formulário de material, do link da campanha
- a pessoa **quis** receber, autorizou
- número quente, raramente bloqueia, converte muito melhor
- **é sempre atendida primeiro**

### Fila Fria — a "super lista"
- contato que nunca ouviu falar da campanha
- origem externa (ver alerta jurídico no item 9)
- é a que dá trabalho, converte menos e arrisca os números
- só é atendida depois que a fila quente do dia acaba

**Por que a ordem importa (não é detalhe):** quando o número conversa primeiro com quem quer falar, ele gera troca real de mensagens e fica mais "saudável" aos olhos do WhatsApp. Isso o deixa mais resistente quando encostar na lista fria. Começar pela lista fria é queimar o número à toa.

---

## 5. O que o atendente faz (resumo — detalhe no Documento 3)

Trabalha no computador, com o WhatsApp Web de um lado e o painel do outro.

1. Faz login. Na primeira vez, aceita o termo de uso (fica gravado com data/hora).
2. O painel diz quantas conversas ele tem no dia e manda começar pela fila quente.
3. Mostra o contato: nome, cidade, origem.
4. A mensagem já vem escrita, com o nome preenchido.
5. Ele clica em "Abrir conversa" → o chat abre com o texto pronto.
6. Revisa, ajusta se quiser, envia. Conversa normalmente.
7. Volta ao painel e marca o resultado: **Autorizou · Pediu saída · Número errado · Quer ajudar · Encaminhar**.
8. Se autorizou, o painel entrega a próxima mensagem pronta (link do material + convite do canal).
9. O próximo contato carrega sozinho.

**Travas que protegem a operação:**
- teto diário por número (padrão 30)
- janela de horário (padrão 9h–20h)
- intervalo mínimo obrigatório entre conversas (padrão 90s), com o botão travado e contagem regressiva
- não fala com quem já pediu saída
- não fala com quem já está sendo atendido por outro

---

## 6. O que o gestor faz (resumo — detalhe no Documento 3)

**Preparação:**
- sobe a lista em planilha; o sistema limpa (tira repetido, inválido e bloqueado) e mostra o resultado antes de importar
- cadastra os atendentes
- escreve e edita os textos das mensagens (sem depender do dev)
- define teto, horário e o dia bloqueado (eleição)

**Durante a campanha, vê em tempo real:**
- quantos contatos já foram falados e quantos faltam
- autorizações, saídas, sem resposta
- **quantos clicaram no link do material** (a métrica mais confiável — ver item 8)
- desempenho por atendente
- tudo separado por município
- exporta tudo em planilha

---

## 7. O kit de material é o motor de captação (e está subvalorizado)

**Recomendação forte ao Gabriel:** o kit não é "só uma forma de organizar a base". É a peça mais valiosa do projeto.

Pedir santinho, adesivo de carro e camiseta é o motivo mais natural do mundo para alguém entregar nome, telefone, cidade e endereço **por vontade própria**. Cada pedido:

- vira um lead quente, com consentimento gravado
- entra automaticamente na Fila Quente do dia seguinte
- revela no mapa onde estão os apoiadores reais
- adesivo de carro ainda é propaganda que circula pela cidade de graça

É a forma mais barata de trocar lead ruim (lista fria) por lead bom (opt-in real). Usar isso só como planilha interna é desperdiçar a melhor carta.

---

## 8. O clique no link é o único dado que é seu de verdade

Ponto estratégico que atravessa o projeto inteiro.

O atendente pode marcar "Autorizou" sem ter autorizado. A conversa acontece no WhatsApp dele, fora do alcance do sistema. Se o número dele cair, a conversa some junto e ninguém recupera.

**O que o sistema controla de verdade é o clique no link.** Cada contato recebe um link único (`/r/{token}`). Quando a pessoa clica, fica registrado: quando, de qual contato, de qual atendente, qual município.

Consequência prática para o script e para o treinamento:

> **O objetivo do primeiro contato não é convencer ninguém a votar. É levar a pessoa a clicar no link e entrar no canal da campanha.**

Se a pessoa entrou no canal, o relacionamento sobrevive à morte do chip. Se ficou só na conversa, morre com o chip. Além disso, o clique com data/IP é a prova de consentimento que a defesa jurídica precisa.

---

## 9. Alertas jurídicos (leia antes de subir)

> **Isto não é parecer jurídico.** É levantamento de risco para orientar decisões. A validação final é de um advogado eleitoral, e ela precisa acontecer **antes** da operação começar.

**Contexto legal (eleições 2026):** o disparo em massa de mensagens de conteúdo político-eleitoral continua proibido (Resolução TSE 23.610/2019, atualizada pela 23.755/2026). A minirreforma que abriria exceção para envio automatizado (PL 4.822/2025) **não é lei** — está parada no Senado, com sinalização de veto. Não se pode contar com ela.

**Os cinco pontos de atenção:**

1. **Origem da lista fria.** A venda, doação ou cessão de cadastros de eleitores para campanhas é vedada. Uma "super lista" cedida por terceiro é exatamente o ponto que a Justiça Eleitoral e a ANPD já puniram. **Pergunta que precisa ser respondida antes de tudo: de onde veio essa lista?** Se foi comprada ou cedida, nenhuma solução técnica conserta o problema de origem.

2. **Base defensável.** A defesa é "pessoa natural conversando de forma privada". Por isso o envio é manual, o texto é revisável, e o sistema não dispara. Todo desenho técnico serve para sustentar essa posição.

3. **Direito de saída.** Quem pede para sair vira bloqueio na hora e tem os dados apagados no prazo (48h). Envio após pedido de saída gera multa por mensagem. O sistema automatiza isso.

4. **Dado sensível.** Preferência de voto é dado sensível e **não pode ser registrado em lugar nenhum** — nem em campo livre, nem em observação, nem em etiqueta.

5. **Exposição do atendente.** O número que aparece numa eventual denúncia é o do atendente, não o da campanha. O termo de uso protege a campanha; o atendente precisa saber disso antes de aceitar, e não pode ser remunerado por mensagem enviada.

**Providências concretas no sistema (todas já previstas):**
- todo registro de envio guarda quem, para quem, quando
- lista de bloqueio permanente para quem saiu
- termo de uso com aceite datado
- página de link com aviso de privacidade e opção de descadastro
- nenhum campo para preferência de voto

---

## 10. Cronograma realista

| Data | O quê |
|---|---|
| **Sáb 23/08** | Preparação (chips, listas, textos, contas de infra). Nada de código. |
| **Dom 24/08** | Construção intensiva (ver Documento 2). |
| **Seg 25/08** | **Piloto: 2 atendentes, 50 contatos.** Não é largada. |
| **Ter–Sex 26–29/08** | Ajustes, extensão do painel lateral, treinamento dos outros 13. |
| **~01/09** | **Operação cheia, 15 atendentes.** |
| **04/10** | Eleição (1º turno). |

**Por que a operação cheia só em ~01/09:** chip de WhatsApp novo precisa de ~10 dias de uso normal antes de falar com desconhecido, senão cai em poucos dias. Chips comprados no dia 23 ficam prontos por volta do dia 1º. Adiantar 5 dias e queimar metade dos números sai muito mais caro. Mesmo assim sobra um mês inteiro de operação.

**Segunda-feira é piloto, não lançamento.** Isso precisa estar combinado com o Gabriel desde já.

---

## 11. Custos (para o Gabriel)

| Item | Valor | Observação |
|---|---|---|
| Sistema (Vercel + Supabase) | ~R$ 0 a R$ 250/mês | Cabe no plano gratuito no começo |
| Domínio dos links | ~R$ 50/ano | |
| Chips + planos (30 no total) | R$ 1.000 a R$ 1.500/mês | 15 ativos + 15 reservas |
| **Total de infra** | **R$ 1.100 a R$ 1.800/mês** | Cabe folgado nos R$ 3k disponíveis |
| Desenvolvimento | valor à parte, uma vez | |
| Acompanhamento mensal | valor à parte | Monitorar, trocar chip, ajustar texto, dar suporte |

**Cobrança em três linhas separadas:** desenvolvimento (uma vez), infra (repassada pelo custo, com nota) e acompanhamento (mensal). Nunca um número só. E definir horário de atendimento no contrato.

---

## 12. O que o sistema explicitamente NÃO faz

Deixar claro para o Gabriel evita frustração depois:

- não manda mensagem sozinho
- não adiciona ninguém em grupo
- não mostra as conversas dos atendentes para o gestor (quem conversa é o atendente, no WhatsApp dele)
- não garante que o WhatsApp não vá bloquear um número — isso é decisão da Meta, fora do controle de qualquer um
- não coleta nem valida a origem da lista — isso é responsabilidade de quem fornece
