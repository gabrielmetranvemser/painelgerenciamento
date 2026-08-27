# Painel de Gerenciamento de Contatos

**Documento 2 de 3 — Construção Técnica**

> Para o dev. Assume leitura prévia do Documento 1. Aqui está a arquitetura, o banco, a extensão e a ordem de construção do dia intensivo.

---

## 1. Stack

| Camada | Tecnologia | Papel |
|---|---|---|
| Frontend | React + Vite | Painel do atendente e do gestor |
| Hospedagem | Vercel | Deploy contínuo do frontend |
| Banco + Auth | Supabase (Postgres) | Dados, login, regras de acesso, funções |
| Extensão | Chrome Side Panel | Painel na lateral do navegador (fase 2) |
| Automações | Supabase cron / Edge Functions | Regras de 72h, 48h, expiração de lease |

**Não há servidor de WhatsApp.** Não há VPS, Docker, Baileys, Evolution. O envio é manual via link `web.whatsapp.com/send`. Se em algum momento surgir a tentação de "só automatizar o envio", releia o item 2 do Documento 1.

---

## 2. Arquitetura em uma imagem

```
┌─────────────────────────────────────────────────────┐
│  NAVEGADOR DO ATENDENTE (Chrome, no computador)      │
│                                                       │
│  ┌──────────────────────┐   ┌──────────────────────┐│
│  │  Aba: WhatsApp Web   │   │  Painel (React/Vercel)││
│  │  logado no chip dele  │   │  ou Side Panel (ext.) ││
│  └──────────────────────┘   └──────────┬───────────┘│
└────────────────────────────────────────┼────────────┘
                                          │ HTTPS
                                          ▼
                              ┌───────────────────────┐
                              │  Supabase             │
                              │  - Postgres (dados)   │
                              │  - Auth (login)       │
                              │  - RLS (permissões)   │
                              │  - Funções (fila)     │
                              │  - Cron (automações)  │
                              └───────────────────────┘

Landing de captação (/r/{token} e /kit) → mesma Vercel → grava no Supabase
```

O clique em "Abrir conversa" monta a URL `https://web.whatsapp.com/send?phone={E164}&text={texto}` e abre na aba do WhatsApp. No computador, isso abre a conversa dentro do WhatsApp Web já logado, com o texto preenchido.

---

## 3. Modelo de dados (Supabase / Postgres)

Schema comentado. Ajustar nomes conforme convenção do time, mas manter a estrutura.

```sql
-- =========================================================
-- ENUMS
-- =========================================================
create type origem_contato   as enum ('site', 'kit', 'lista_fria');
create type status_contato    as enum ('novo','na_fila','em_atendimento',
                                       'autorizou','pediu_saida','invalido',
                                       'quer_ajudar','encaminhado','sem_resposta','perdido');
create type etapa_msg         as enum ('permissao','material','saida',
                                       'quem_passou','quer_ajudar','encaminhamento','convite_grupo');
create type status_chip       as enum ('aquecendo','ativo','amarelo','pausado','morto');
create type papel_usuario     as enum ('gestor','atendente');

-- =========================================================
-- USUÁRIOS (liga ao auth do Supabase)
-- =========================================================
create table usuarios (
  id            uuid primary key references auth.users(id) on delete cascade,
  papel         papel_usuario not null default 'atendente',
  primeiro_nome text not null,
  ativo         boolean not null default true,
  termo_aceito_em timestamptz,
  criado_em     timestamptz not null default now()
);

-- =========================================================
-- CHIPS (números de WhatsApp) — teto e saúde por CHIP, não por pessoa
-- =========================================================
create table chips (
  id             uuid primary key default gen_random_uuid(),
  atendente_id   uuid not null references usuarios(id),
  rotulo         text not null,              -- "Chip A", "Chip B"
  numero_e164    text,                       -- opcional; ajuda no relatório
  papel_chip     text not null default 'ativo', -- 'ativo' | 'reserva'
  status         status_chip not null default 'aquecendo',
  dia_rampa      int not null default 1,     -- controla o teto durante o aquecimento
  teto_hoje      int not null default 30,
  enviados_hoje  int not null default 0,
  pausado_ate    timestamptz,
  criado_em      timestamptz not null default now()
);

-- =========================================================
-- LISTAS importadas (rastreabilidade jurídica)
-- =========================================================
create table listas (
  id            uuid primary key default gen_random_uuid(),
  origem        origem_contato not null,
  entregue_por  text,                        -- OBRIGATÓRIO para lista_fria
  entregue_em   date,
  arquivo_hash  text,                        -- hash do CSV original
  total_linhas  int,
  total_validos int,
  ativa         boolean not null default true,
  criado_em     timestamptz not null default now()
);

-- =========================================================
-- CONTATOS
-- =========================================================
create table contatos (
  id             uuid primary key default gen_random_uuid(),
  lista_id       uuid references listas(id),
  origem         origem_contato not null,
  nome           text,
  telefone_e164  text not null,
  telefone_variante text,                    -- forma sem o 9, para dedup (ver item 5)
  municipio      text,
  status         status_contato not null default 'novo',
  atendente_id   uuid references usuarios(id),
  chip_id        uuid references chips(id),
  claimed_at     timestamptz,
  claim_expira_em timestamptz,
  criado_em      timestamptz not null default now(),
  unique (telefone_e164)                     -- trava dedup no banco
);
create index idx_contatos_fila on contatos (status, origem, atendente_id);

-- =========================================================
-- INTERAÇÕES (log de cada passo — prova jurídica)
-- =========================================================
create table interacoes (
  id           uuid primary key default gen_random_uuid(),
  contato_id   uuid not null references contatos(id),
  atendente_id uuid not null references usuarios(id),
  chip_id      uuid references chips(id),
  etapa        etapa_msg not null,
  variacao_id  uuid,
  aberto_wa_em timestamptz,                   -- quando clicou em "Abrir conversa"
  resultado    status_contato,
  resultado_em timestamptz,
  criado_em    timestamptz not null default now()
);

-- =========================================================
-- BLOQUEIOS (quem pediu saída — guarda HASH, não o número)
-- =========================================================
create table bloqueios (
  telefone_hmac text primary key,             -- HMAC do E164, não o número em claro
  motivo        text,
  criado_em     timestamptz not null default now(),
  apagar_em     timestamptz not null
);

-- =========================================================
-- MODELOS e VARIAÇÕES de mensagem (gestor edita)
-- =========================================================
create table modelos (
  id        uuid primary key default gen_random_uuid(),
  etapa     etapa_msg not null,
  nome      text not null,
  ativo     boolean not null default true
);
create table variacoes (
  id        uuid primary key default gen_random_uuid(),
  modelo_id uuid not null references modelos(id) on delete cascade,
  texto     text not null,
  ordem     int not null default 0
);

-- rotação por CHIP (o mesmo número nunca repete a variação em seguida)
create table rotacao_chip (
  chip_id         uuid not null references chips(id),
  modelo_id       uuid not null references modelos(id),
  ultima_variacao uuid,
  primary key (chip_id, modelo_id)
);

-- =========================================================
-- LINKS rastreados e CLIQUES
-- =========================================================
create table destinos (
  id     uuid primary key default gen_random_uuid(),
  nome   text not null,          -- "material", "canal"
  url    text not null           -- gestor troca sem mudar o token
);
create table links (
  token       text primary key,  -- token curto por contato
  contato_id  uuid references contatos(id),
  destino_id  uuid references destinos(id),
  criado_em   timestamptz not null default now()
);
create table cliques (
  id             uuid primary key default gen_random_uuid(),
  token          text references links(token),
  ts             timestamptz not null default now(),
  ip             text,
  user_agent     text,
  cidade_informada text
);

-- =========================================================
-- CAPTAÇÃO (site e kit)
-- =========================================================
create table captacoes (
  id           uuid primary key default gen_random_uuid(),
  origem       origem_contato not null,       -- 'site' | 'kit'
  nome         text,
  telefone_e164 text,
  municipio    text,
  endereco     text,                          -- só para kit
  itens        text,                          -- santinho, adesivo, camiseta
  aceite_em    timestamptz not null default now(),
  ip           text,
  virou_contato boolean not null default false
);

-- =========================================================
-- CONFIG da equipe (linha única)
-- =========================================================
create table config (
  id            int primary key default 1,
  teto_diario   int not null default 30,
  hora_inicio   int not null default 9,
  hora_fim      int not null default 20,
  intervalo_seg int not null default 90,
  dia_bloqueado date,                          -- dia da eleição
  termo_texto   text
);
```

---

## 4. Segurança de acesso (RLS — não é opcional)

Sem Row Level Security, qualquer atendente lê a base inteira pelo navegador. Configurar **junto** com as tabelas, não depois.

Regras:

- **Atendente** lê e escreve só nos contatos onde `atendente_id = auth.uid()`.
- **Atendente** lê os modelos/variações/config (precisa do texto), mas não edita.
- **Gestor** lê e escreve tudo.
- `bloqueios`, `cliques`, `captacoes`: escrita liberada só via função/rota controlada (a landing grava sem login).

```sql
alter table contatos enable row level security;

create policy contato_atendente_rw on contatos
  for all to authenticated
  using ( atendente_id = auth.uid()
          or exists (select 1 from usuarios u
                     where u.id = auth.uid() and u.papel = 'gestor') )
  with check ( atendente_id = auth.uid()
          or exists (select 1 from usuarios u
                     where u.id = auth.uid() and u.papel = 'gestor') );
```

Aplicar o padrão equivalente às demais tabelas.

---

## 5. As duas funções que NÃO podem ter bug

Escrever e testar **com cabeça descansada**, nas primeiras horas do dia. Bug aqui é multa e denúncia.

### 5.1 Normalização e dedup de telefone (a pegadinha do nono dígito)

Números brasileiros chegam em ~8 formatos. Em Rondônia (DDD 69), o **mesmo** número aparece com e sem o 9:
- `+55 69 9 1234-5678`
- `+55 69 1234-5678`
- `(69) 91234-5678`
- `6991234567`

Se tratados como pessoas diferentes, **dois atendentes ligam para a mesma pessoa** — o que pode virar denúncia.

Regra:
1. limpar tudo que não é dígito
2. garantir DDI 55
3. produzir a forma canônica E.164 (`telefone_e164`)
4. produzir também a variante **sem o nono dígito** (`telefone_variante`)
5. deduplicar comparando **canônica E variante** contra o que já existe

```
função normalizar(bruto):
    d = só_dígitos(bruto)
    se d começa com "55": tira "55"
    se len(d) == 11 e d[2] == "9":   # com nono dígito
        canonica = "55" + d
        variante = "55" + d[0:2] + d[3:]   # remove o 9
    senão se len(d) == 10:            # sem nono dígito
        canonica = "55" + d[0:2] + "9" + d[2:]  # adiciona o 9
        variante = "55" + d
    retorna (canonica, variante)

na importação:
    (c, v) = normalizar(linha.telefone)
    se existe contato com telefone_e164 in (c, v)
       ou telefone_variante in (c, v):  → DUPLICADO, pula
    se hmac(c) existe em bloqueios:      → BLOQUEADO, pula
    senão insere
```

### 5.2 Lista de bloqueio por hash

Promessa: apagar o número em 48h. Problema: como impedir que ele volte na próxima importação, se foi apagado?

Solução: guardar o **HMAC** do telefone, não o número. Dá para checar se um número está bloqueado sem armazenar o número em claro. Alinha com LGPD.

```
ao marcar "Pediu saída":
    h = hmac_sha256(contato.telefone_e164, CHAVE_SECRETA)
    insere em bloqueios (telefone_hmac=h, apagar_em=now()+48h)
    contato.status = 'pediu_saida'
    (cron apaga nome/telefone do contato em 48h; o HMAC permanece)
```

A `CHAVE_SECRETA` fica em variável de ambiente, nunca no código nem no banco.

---

## 6. A fila: claim atômico

Dois atendentes não podem pegar o mesmo contato. **Nunca** faça "busca o próximo e depois marca" no frontend — sob concorrência, colide.

Resolver no Postgres com `FOR UPDATE SKIP LOCKED`:

```sql
create or replace function pegar_proximo_contato(p_atendente uuid, p_chip uuid)
returns contatos as $$
declare c contatos;
begin
  select * into c from contatos
   where status = 'na_fila'
     and (claim_expira_em is null or claim_expira_em < now())
   order by
     case origem when 'site' then 0 when 'kit' then 0 else 1 end,  -- QUENTE primeiro
     criado_em
   for update skip locked
   limit 1;

  if not found then return null; end if;

  update contatos
     set status='em_atendimento', atendente_id=p_atendente, chip_id=p_chip,
         claimed_at=now(), claim_expira_em = now() + interval '20 minutes'
   where id = c.id
   returning * into c;

  return c;
end; $$ language plpgsql security definer;
```

**Lease de 20 minutos**, não 24h. Contato preso é fila parada. Um cron devolve à fila os leases vencidos.

### 6.1 A fila não é um bolo só: cada lista tem dono

`atendente_listas (atendente_id, lista_id)` diz quem atende o quê, e o claim só
entrega um contato de lista a quem tem aquela lista marcada. É o mesmo desenho
de `atendente_candidatos`.

Quatro regras que caem daí, e nenhuma é acidental:

- **Sem marcação = não recebe.** O contrário seria mais macio no dia do deploy,
  mas transformaria o esquecimento do gestor em vazamento silencioso: a lista
  que ele quis dar só ao Gabriel continuaria caindo no Filipe. Aqui o
  esquecimento PARA a fila da pessoa, com motivo próprio (`sem_lista`) na tela
  do atendente e contador no menu do gestor (`v_atendentes_sem_lista`).
- **Contato sem lista continua de todo mundo.** Quem se cadastrou sozinho pela
  página do candidato (`contatos.lista_id is null`) não pertence a lista nenhuma
  e é o contato mais valioso que existe — ele pediu para ser chamado.
- **Lista pausada (`ativa = false`) sai da fila na hora**, mesmo de quem a tem
  marcada. O que pausar NÃO faz é interromper conversa já aberta: quem está com
  o contato na mão termina o que começou.
- **A mesma lista em dois atendentes é dividida** pelo `for update skip locked`
  de sempre. Não há risco de os dois falarem com a mesma pessoa.

O atendente trabalha de duas formas. No **automático** (padrão) a fila mistura
todas as listas dele e o contato chega etiquetado com a de origem
(`contato_json` devolve `lista_id` e `lista`; a cor do ponto sai de
`src/lib/cor-lista.ts`, e é identificador, não significado). No **manual** ele
passa `p_lista_id` e recebe só daquela lista — e o servidor confere se ela é
mesmo dele (`lista_nao_e_sua`), porque escolha de tela se burla com o DevTools
aberto.

⚠️ O predicado de disponibilidade aparece **três vezes**: em
`pegar_proximo_contato` (o claim), em `fila_status` (o contador) e em
`minhas_listas` (o cardápio). Repetido de propósito — `security definer` não é
inlineável e o claim varre a fila inteira. Os dois primeiros TÊM de andar
juntos: quando divergiram por causa do candidato, o painel dizia "1 quente na
fila", o atendente clicava e recebia "não há mais contatos". `supabase/tests/15_listas.sql`
confere que os três concordam.

---

## 6.2 ⚠️ O PostgREST corta em 1.000 linhas, e não avisa

`max_rows` deste projeto é **1.000**. Toda resposta maior é truncada em silêncio:
volta `data` com 1.000 linhas, `count` com o total certo e `error` nulo. Quem
escreveu `.limit(5000)` acha que recebeu 5.000.

Três lugares tinham sido escritos assim, e os três mentiam:

| Onde | Escrito | Chegava |
|---|---|---|
| Tela de Contatos | `.limit(5000)` | 1.000 — **e a busca rodava dentro desses 1.000** |
| CSV de contatos | `.limit(50000)` | 1.000 |
| Entregas / CSV do kit | `.limit(2000)` / sem limite | 1.000 |

O pior era a tela: procurar alguém que estava na base e receber "nada com esses
filtros" faz o gestor concluir que a pessoa não existe.

**As duas saídas, e quando usar cada uma:**

- **Tela** → paginação de verdade. Quem filtra, conta e pagina é o banco
  (`contatos_do_gestor`), e o navegador recebe 100 linhas. Levantar `max_rows`
  não serviria: 30 mil linhas no navegador é o travamento que se quer evitar.
- **Arquivo ou conta** → `buscarTudo()` de `src/lib/supabase/paginar.ts`, que
  vai em blocos até acabar. ⚠️ Ele avança pelo que **veio**, não pelo que foi
  pedido — um laço que somasse o tamanho pedido pararia cedo se o teto do
  projeto mudasse, truncando em silêncio de novo.

Regra prática: **`.limit(n)` com n > 1000 é sempre bug.** Ou é tela, e quer
paginação, ou é arquivo, e quer `buscarTudo`.

---

## 7. Travas de volume, horário e intervalo

Validar **no servidor** (função), nunca só no frontend — frontend se burla.

Ao pedir o próximo contato, a função verifica:
- `chips.status not in ('pausado','morto')`
- `now()` dentro de `[hora_inicio, hora_fim]`
- `today <> config.dia_bloqueado`
- `chips.enviados_hoje < chips.teto_hoje`
- último `aberto_wa_em` do chip há mais de `intervalo_seg` segundos

Se qualquer uma falhar, retorna o motivo e o frontend mostra o botão travado com contagem regressiva.

**Rampa de aquecimento** (o `teto_hoje` sobe com `dia_rampa`):

| Dia do chip | Teto | Intervalo |
|---|---|---|
| 1 | 5 | 120s |
| 2 | 8 | 120s |
| 3 | 12 | 90s |
| 4 | 18 | 90s |
| 5 | 25 | 60s |
| 6+ | 30 | 60s |

Cron diário zera `enviados_hoje` e incrementa `dia_rampa` até 6.

---

## 8. Rotação de variação por chip

O mesmo número nunca manda a mesma variação em contatos seguidos (o antispam olha o número).

```
ao montar a mensagem de uma etapa para um chip:
    ultima = rotacao_chip[chip, modelo].ultima_variacao
    proxima = próxima variação na ordem, pulando 'ultima'
    grava rotacao_chip[chip, modelo].ultima_variacao = proxima
    retorna texto(proxima) com variáveis substituídas
```

**Variáveis:** `{{saudacao}}` (por hora), `{{primeiro_nome}}`, `{{nome}}` (do atendente), `{{candidato}}`, `{{cargo}}`, `{{numero}}`, `{{link}}`, `{{link_grupo}}`, `{{municipio}}`.

**Blocos travados** (a Permissão e o Material só salvam se contiverem): `{{candidato}}` + `{{cargo}}` na mesma frase, a menção de que o contato veio de um apoiador, e a frase de parar/apagar. Validar no editor do gestor.

---

## 9. Links rastreados e landing

- rota `/r/{token}`: registra o clique (ts, ip, user_agent), depois redireciona para o `destino` atual. O gestor troca o destino sem trocar o token.
- landing de captação: botão "Quero receber" (grava aceite com data/hora/IP), campo cidade, botão do canal, aviso de privacidade, botão "não quero receber" (gera bloqueio).
- `/kit`: formulário (nome, telefone, cidade, endereço, itens). Ao enviar, cria uma `captacao` origem `kit` → vira contato na Fila Quente.

**Privacidade:** nunca colocar dado pessoal na URL. O token não contém o telefone; é aleatório e aponta para o contato no banco.

---

## 10. A extensão do Chrome (fase 2 — não é para o dia 1)

Três níveis. Construir **só o Nível 0** para a campanha. Os outros ficam para depois.

### Nível 0 — Painel lateral (o que queremos)
Usa a API **Side Panel** do Chrome. A extensão apenas renderiza o painel (a mesma aplicação React) numa barra lateral fixa. **Não lê, não toca, não injeta nada no WhatsApp Web.** Para a Meta, é invisível. Risco zero. ~3 a 5 dias sobre o painel pronto.

Resultado: WhatsApp Web na aba, painel na lateral, zero troca de aba.

### Nível 1 — Produtividade (ainda sem tocar no WhatsApp)
Atalhos de teclado para marcar resultado, biblioteca de respostas prontas (os 13 casos do "Como agir"), timer/trava visual, follow-up agendado. Tudo do lado do painel. Risco zero.

### Nível 2 — Leitura do WhatsApp (risco médio — adiar)
A extensão injeta script no `web.whatsapp.com` e **lê** a tela: detecta envio, detecta resposta, abre conversa sem recarregar. Ganho real (elimina o recarregamento de 5–10s por contato), mas viola termos, quebra quando a Meta muda a página, e pode falhar em plena semana de eleição. **Só depois da campanha, e como melhoria removível.**

### Nível 3 — Envio automático
**Não fazer.** Vira disparo. Sai da posição defensável. E economiza só ~10 min/dia de alguém.

### Distribuição da extensão
- **Chrome Web Store como "não listada"** é o ideal, mas a revisão leva de dias a mais de uma semana → **submeter cedo**. Extensão Nível 0 (só painel próprio) passa fácil; Nível 2 levanta bandeira.
- Alternativa imediata: instalação manual no modo desenvolvedor em cada máquina (o Chrome fica avisando, dá trabalho com 15 pessoas).
- **Para a campanha, o painel funciona 100% sem extensão nenhuma**, como aba normal ao lado do WhatsApp Web. A extensão é conforto, não requisito.

---

## 11. Automações (Supabase cron)

| Rotina | Frequência | Ação |
|---|---|---|
| Zerar contadores | diária 00h | `enviados_hoje = 0`, `dia_rampa++` até 6 |
| Expirar lease | a cada 5 min | lease vencido → `status = 'na_fila'` |
| Sem resposta 72h | diária | contato aberto há +72h sem resultado → `sem_resposta`, sai da fila |
| Apagar dados de saída | diária | `bloqueios.apagar_em < now()` → limpa nome/telefone do contato (mantém HMAC) |
| Reciclar não tratados | diária | `em_atendimento` há +24h → volta para `na_fila` |

---

## 12. Ordem de construção do dia intensivo

> Regra de ouro: **correção antes de interface.** As duas funções do item 5 primeiro, com a cabeça boa.

| Bloco | ~4h | Entrega |
|---|---|---|
| **1. Fundação** | | Schema + RLS no Supabase; Auth; termo no 1º login; deploy Vercel vazio no ar |
| **2. Importação** | | Upload CSV, normalização, dedup (item 5.1), checagem de bloqueio, tela de conferência. **Testar com o CSV real.** |
| **3. Fila + atendente** | | Função de claim (item 6), lease 20min, card do contato, mensagem montada, botão "Abrir conversa" |
| **4. Resultado + travas** | | Botões de resultado, próxima mensagem, próximo contato, teto/horário/intervalo, "Pediu saída" → bloqueio |
| **5. Links + captação** | | `/r/{token}`, landing de aceite, `/kit`, troca de destino pelo gestor |
| **6. Gestor + teste** | | Painel (totais, por atendente, por município, cliques), export CSV, criar os 15 usuários, rodar fluxo ponta a ponta com 20 contatos de teste, deploy final |

**Para o piloto de segunda, o mínimo indispensável é: blocos 1, 2, 3, 4.** Os blocos 5 e 6 podem escorregar para terça sem impedir o piloto (mas o link rastreado é muito importante — priorizar dentro do bloco 5 pelo menos o `/r/{token}`).

---

## 13. Variáveis de ambiente

```
SUPABASE_URL=
SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=   # só no servidor, nunca no frontend
HMAC_SECRET=                 # chave do hash de bloqueio
LINK_BASE_URL=               # domínio dos links rastreados
```

---

## 14. Convenções para o CLAUDE.md do repositório

Deixar no repo um `CLAUDE.md` curto com:
- este princípio no topo: **"O sistema nunca envia mensagem sozinho. Envio é sempre manual, via link. Não sugerir Baileys, Evolution, Puppeteer ou envio automático em nenhuma hipótese."**
- as duas funções críticas (dedup e bloqueio) marcadas como "não alterar sem teste"
- o padrão de RLS
- a stack e os comandos de dev/deploy
