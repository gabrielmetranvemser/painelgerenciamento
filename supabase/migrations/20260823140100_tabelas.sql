-- =============================================================================
-- Tabelas
-- =============================================================================

-- ── Configuração da operação (linha única) ───────────────────────────────────
create table public.config (
  id             int primary key default 1 check (id = 1),

  -- CORREÇÃO (não está no documento): o Postgres roda em UTC e a operação é em
  -- Rondônia (UTC−4). Sem isto, a janela "9h–20h" abriria às 5h da manhã.
  -- TODA conta de hora, saudação e "dia operacional" passa por aqui.
  timezone       text not null default 'America/Porto_Velho',

  teto_diario    int  not null default 30 check (teto_diario between 1 and 200),
  hora_inicio    int  not null default 9  check (hora_inicio between 0 and 23),
  hora_fim       int  not null default 20 check (hora_fim between 1 and 24),
  intervalo_seg  int  not null default 90 check (intervalo_seg between 0 and 3600),
  lease_minutos  int  not null default 20 check (lease_minutos between 1 and 240),

  -- variáveis das mensagens, editáveis pelo gestor sem depender do dev
  candidato      text not null default '',
  cargo          text not null default '',
  numero         text not null default '',

  termo_texto    text not null default '',
  termo_versao   int  not null default 1,

  atualizado_em  timestamptz not null default now(),
  constraint horario_coerente check (hora_fim > hora_inicio)
);

-- Dia da eleição e qualquer outra data em que não se fala com ninguém.
-- É tabela, e não coluna única em config, porque existe 1º e 2º turno.
create table public.dias_bloqueados (
  data      date primary key,
  motivo    text not null default 'Dia da eleição',
  criado_em timestamptz not null default now()
);

-- Lista fechada para o relatório por município sair confiável. Campo livre
-- produziria "Porto Velho", "porto velho" e "Pto Velho" como três cidades.
create table public.municipios (
  id   smallint generated always as identity primary key,
  uf   char(2) not null default 'RO',
  nome text not null,
  unique (uf, nome)
);

-- ── Pessoas ──────────────────────────────────────────────────────────────────
create table public.usuarios (
  id              uuid primary key references auth.users(id) on delete cascade,
  papel           public.papel_usuario not null default 'atendente',
  primeiro_nome   text not null check (length(btrim(primeiro_nome)) between 2 and 40),
  ativo           boolean not null default true,
  -- sem aceite datado, a fila não entrega contato (docs/03-OPERACAO.md §4)
  termo_aceito_em timestamptz,
  termo_versao    int,
  criado_em       timestamptz not null default now()
);

-- ── Chips (números de WhatsApp) ──────────────────────────────────────────────
-- Teto e saúde são por CHIP, não por pessoa: o antispam do WhatsApp olha o
-- número. Um atendente com dois chips tem dois tetos separados.
create table public.chips (
  id                      uuid primary key default gen_random_uuid(),
  atendente_id            uuid not null references public.usuarios(id) on delete cascade,
  rotulo                  text not null,                    -- "Chip A", "Chip B"
  numero_e164             text,                             -- opcional, ajuda no relatório
  papel                   public.papel_chip not null default 'ativo',
  status                  public.status_chip not null default 'aquecendo',
  pausado_ate             timestamptz,
  observacao              text,
  criado_em               timestamptz not null default now(),
  unique (atendente_id, rotulo)

  -- CORREÇÃO: o documento previa `enviados_hoje` e `dia_rampa` como colunas.
  -- Ambas são DERIVADAS de `interacoes` (ver funcoes_fila.sql). Contador
  -- materializado depende de um cron rodar à meia-noite certa, e quando ele
  -- falha o chip trabalha o dobro sem ninguém perceber. Derivar não tem
  -- como dessincronizar.
);

-- ── Listas importadas (rastreabilidade jurídica) ─────────────────────────────
create table public.listas (
  id               uuid primary key default gen_random_uuid(),
  origem           public.origem_contato not null,
  rotulo           text not null,
  entregue_por     text,
  entregue_em      date,
  arquivo_nome     text,
  arquivo_hash     text,
  total_linhas     int not null default 0,
  total_importados int not null default 0,
  total_duplicados int not null default 0,
  total_bloqueados int not null default 0,
  total_invalidos  int not null default 0,
  ativa            boolean not null default true,
  criado_por       uuid references public.usuarios(id) on delete set null,
  criado_em        timestamptz not null default now(),

  -- Lista fria sem procedência não entra. Isto é exigência jurídica
  -- (docs/01-VISAO-GERAL.md §9.1) e fica no BANCO, não numa validação de tela
  -- que alguém desliga: sem rastreabilidade não há defesa.
  constraint lista_fria_exige_procedencia check (
    origem <> 'lista_fria'
    or (entregue_por is not null and btrim(entregue_por) <> '' and entregue_em is not null)
  )
);

-- ── Mensagens ────────────────────────────────────────────────────────────────
create table public.modelos (
  id            uuid primary key default gen_random_uuid(),
  etapa         public.etapa_msg not null unique,
  nome          text not null,
  ativo         boolean not null default true,
  atualizado_em timestamptz not null default now()
);

create table public.variacoes (
  id        uuid primary key default gen_random_uuid(),
  modelo_id uuid not null references public.modelos(id) on delete cascade,
  texto     text not null check (btrim(texto) <> ''),
  ordem     int not null default 0,
  ativa     boolean not null default true,
  criado_em timestamptz not null default now()
);

-- O mesmo número nunca manda a mesma variação em contatos seguidos. A rotação
-- é por CHIP porque é o número que o antispam observa, não o atendente.
create table public.rotacao_chip (
  chip_id            uuid not null references public.chips(id) on delete cascade,
  modelo_id          uuid not null references public.modelos(id) on delete cascade,
  ultima_variacao_id uuid references public.variacoes(id) on delete set null,
  atualizado_em      timestamptz not null default now(),
  primary key (chip_id, modelo_id)
);

-- ── Links rastreados ─────────────────────────────────────────────────────────
-- O gestor troca a URL de destino sem trocar os tokens já enviados.
create table public.destinos (
  id            uuid primary key default gen_random_uuid(),
  chave         text not null unique,   -- 'material' | 'canal'
  nome          text not null,
  url           text not null,
  atualizado_em timestamptz not null default now()
);

-- ── Contatos ─────────────────────────────────────────────────────────────────
create table public.contatos (
  id            uuid primary key default gen_random_uuid(),
  lista_id      uuid references public.listas(id) on delete set null,
  origem        public.origem_contato not null,

  nome          text,
  primeiro_nome text,

  -- Só dígitos, com DDI, com o nono: "5569981234567".
  -- É o que web.whatsapp.com/send?phone= espera. Apagado na purga de 48h.
  telefone_e164 text,

  -- CORREÇÃO: o documento usava `unique (telefone_e164)`, que NÃO pega o mesmo
  -- número escrito em formatos diferentes. `chave_dedup` é DDD + os 8 dígitos
  -- finais (sem o nono), então "(69) 98123-4567" e "(69) 8123-4567" produzem a
  -- MESMA chave e o índice único resolve o dedup aqui, no banco, em vez de
  -- depender de o código lembrar de checar as duas formas.
  chave_dedup   text,

  -- HMAC do telefone. Preenchido pelo servidor na importação, para a função de
  -- fila poder filtrar bloqueados sem nunca ver a chave secreta.
  -- SOBREVIVE à purga de 48h: é o que impede um número apagado de voltar numa
  -- importação futura.
  telefone_hmac text not null,
  hmac_versao   int not null default 1,

  municipio_id  smallint references public.municipios(id) on delete set null,
  status        public.status_contato not null default 'na_fila',

  atendente_id  uuid references public.usuarios(id) on delete set null,
  chip_id       uuid references public.chips(id) on delete set null,

  claimed_at        timestamptz,
  claim_expira_em   timestamptz,
  primeiro_contato_em timestamptz,
  resultado_em      timestamptz,

  -- texto curto do "Encaminhar". Único campo livre do sistema.
  -- ⚠️ NUNCA usar para anotar preferência de voto — dado sensível, vedado.
  encaminhamento text check (encaminhamento is null or length(encaminhamento) <= 280),

  anonimizado_em timestamptz,
  criado_em      timestamptz not null default now()
);

-- ── Interações (log de cada passo — é a prova jurídica) ──────────────────────
create table public.interacoes (
  id           uuid primary key default gen_random_uuid(),
  contato_id   uuid not null references public.contatos(id) on delete cascade,
  atendente_id uuid not null references public.usuarios(id),
  chip_id      uuid not null references public.chips(id),
  etapa        public.etapa_msg not null,
  variacao_id  uuid references public.variacoes(id) on delete set null,

  texto_enviado text,          -- o que o painel montou, para auditoria
  aberto_wa_em timestamptz,    -- quando o atendente clicou em "Abrir conversa"

  resultado    public.status_contato,
  resultado_em timestamptz,

  -- Data no fuso da operação. Evita recalcular fuso por linha na conta do teto
  -- e é o que faz "hoje" significar hoje em Porto Velho, não em UTC.
  dia_operacional date not null,

  criado_em    timestamptz not null default now(),

  -- Uma interação por contato por etapa. É isto que torna "Abrir conversa"
  -- idempotente: duplo clique não conta duas vezes no teto do chip.
  unique (contato_id, etapa)
);

-- ── Bloqueios (quem pediu saída) ─────────────────────────────────────────────
-- Guarda o HMAC, nunca o número. Permite cumprir as duas promessas ao mesmo
-- tempo: apagar o número em 48h e nunca mais falar com aquela pessoa.
create table public.bloqueios (
  telefone_hmac text primary key,
  hmac_versao   int not null default 1,
  motivo        text,
  origem        text not null default 'pediu_saida',
  contato_id    uuid references public.contatos(id) on delete set null,
  criado_em     timestamptz not null default now(),
  -- quando apagar o nome e o telefone do contato. O bloqueio em si é permanente.
  apagar_em     timestamptz not null
);

create table public.links (
  token      text primary key,
  contato_id uuid not null references public.contatos(id) on delete cascade,
  destino_id uuid not null references public.destinos(id) on delete cascade,
  criado_em  timestamptz not null default now(),
  unique (contato_id, destino_id)
);

create table public.cliques (
  id         bigint generated always as identity primary key,
  token      text references public.links(token) on delete set null,
  ts         timestamptz not null default now(),

  -- CORREÇÃO (não está no documento): ao enviar a mensagem, o WhatsApp busca a
  -- URL sozinho para montar a pré-visualização. Sem esta coluna, TODO contato
  -- apareceria como "clicou" no segundo seguinte ao envio e a métrica mais
  -- confiável do projeto viraria ruído. Relatório conta só is_bot = false.
  is_bot     boolean not null default false,

  ip         inet,
  user_agent text,
  referer    text
);

-- ── Captação (site e kit) ────────────────────────────────────────────────────
create table public.captacoes (
  id            uuid primary key default gen_random_uuid(),
  origem        public.origem_contato not null check (origem in ('site', 'kit')),
  nome          text,
  telefone_e164 text,
  chave_dedup   text,
  municipio_id  smallint references public.municipios(id) on delete set null,
  endereco      text,                       -- só para o kit
  itens         text[],                     -- santinho, adesivo, camiseta
  aceite_em     timestamptz not null default now(),
  ip            inet,
  user_agent    text,
  virou_contato boolean not null default false,
  contato_id    uuid references public.contatos(id) on delete set null,
  criado_em     timestamptz not null default now()
);

-- ── Alertas para o gestor ────────────────────────────────────────────────────
-- Alimentado pelo botão "Meu WhatsApp está estranho", que vale mais que
-- qualquer métrica automática: o atendente sente a queda antes de o sistema
-- medir (docs/03-OPERACAO.md §5).
create table public.alertas (
  id           bigint generated always as identity primary key,
  tipo         text not null,
  chip_id      uuid references public.chips(id) on delete cascade,
  atendente_id uuid references public.usuarios(id) on delete set null,
  detalhe      text,
  resolvido_em timestamptz,
  criado_em    timestamptz not null default now()
);
