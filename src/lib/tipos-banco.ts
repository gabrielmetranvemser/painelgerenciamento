/**
 * Tipos do banco.
 *
 * Escritos à mão porque `supabase gen types` exige Docker e esta máquina não
 * tem. Se você alterar uma migration, atualize aqui também — ou rode
 * `supabase gen types typescript --db-url "$SUPABASE_DB_URL"` numa máquina com
 * Docker e substitua o arquivo.
 */

/**
 * 'chamou' é a pessoa que escreveu para o atendente por conta própria. Conta
 * como QUENTE na fila — quente é tudo que não é 'lista_fria'.
 */
export type OrigemContato = 'site' | 'kit' | 'lista_fria' | 'chamou';

export type StatusContato =
  | 'novo' | 'na_fila' | 'em_atendimento' | 'autorizou' | 'pediu_saida'
  | 'invalido' | 'quer_ajudar' | 'encaminhado' | 'sem_resposta' | 'perdido';

export type EtapaMsg =
  | 'permissao' | 'material' | 'saida' | 'quem_passou'
  | 'quer_ajudar' | 'encaminhamento' | 'convite_grupo';

export type StatusChip = 'aquecendo' | 'ativo' | 'amarelo' | 'pausado' | 'morto';
export type PapelUsuario = 'gestor' | 'atendente';
export type PapelChip = 'ativo' | 'reserva';

/** Por que a fila se recusou a entregar o próximo contato. */
export type MotivoFila =
  | 'ok' | 'termo_nao_aceito' | 'usuario_inativo' | 'chip_nao_e_seu'
  | 'chip_indisponivel' | 'dia_bloqueado' | 'fora_de_horario'
  | 'teto_atingido' | 'intervalo' | 'fila_vazia';

/** Resultados que o atendente pode marcar. */
export const RESULTADOS = ['autorizou', 'pediu_saida', 'invalido', 'quer_ajudar', 'encaminhado'] as const;
export type Resultado = (typeof RESULTADOS)[number];

export type Config = {
  id: number;
  timezone: string;
  teto_diario: number;
  hora_inicio: number;
  hora_fim: number;
  intervalo_seg: number;
  lease_minutos: number;
  termo_texto: string;
  termo_versao: number;
  /** Quem responde pelos dados (LGPD). É da operação, não de um candidato. */
  responsavel_dados: string;
  atualizado_em: string;
};

/**
 * `config` guarda só o que é da OPERAÇÃO. Nome, cargo, número, material e
 * página de cada candidatura moram em `candidatos` e `materiais` — cópia aqui
 * já saiu de sincronia uma vez e a página pública mostrou o candidato errado.
 */

export type Municipio = { id: number; uf: string; nome: string };
export type DiaBloqueado = { data: string; motivo: string; criado_em: string };

export type Usuario = {
  id: string;
  papel: PapelUsuario;
  primeiro_nome: string;
  ativo: boolean;
  termo_aceito_em: string | null;
  termo_versao: number | null;
  foto_url: string | null;
  criado_em: string;
};

export type Chip = {
  id: string;
  atendente_id: string;
  rotulo: string;
  numero_e164: string | null;
  papel: PapelChip;
  status: StatusChip;
  pausado_ate: string | null;
  observacao: string | null;
  criado_em: string;
};

export type Lista = {
  id: string;
  origem: OrigemContato;
  rotulo: string;
  entregue_por: string | null;
  entregue_em: string | null;
  arquivo_nome: string | null;
  arquivo_hash: string | null;
  total_linhas: number;
  total_importados: number;
  total_duplicados: number;
  total_bloqueados: number;
  total_invalidos: number;
  ativa: boolean;
  /**
   * Quando a importação chegou ao fim. Nulo significa que a aba foi fechada no
   * meio — parte da planilha entrou na fila e o resto não. A tela de importar
   * avisa enquanto isso estiver assim.
   */
  concluida_em: string | null;
  criado_por: string | null;
  criado_em: string;
};

export type Contato = {
  id: string;
  lista_id: string | null;
  origem: OrigemContato;
  nome: string | null;
  primeiro_nome: string | null;
  telefone_e164: string | null;
  chave_dedup: string | null;
  telefone_hmac: string;
  hmac_versao: number;
  municipio_id: number | null;
  status: StatusContato;
  atendente_id: string | null;
  chip_id: string | null;
  claimed_at: string | null;
  claim_expira_em: string | null;
  /** Pulado pelo atendente: fica fora da fila até esta hora passar. */
  adiado_ate: string | null;
  primeiro_contato_em: string | null;
  resultado_em: string | null;
  encaminhamento: string | null;
  /** De qual candidato o lead veio, quando entrou por uma página de candidato. */
  candidato_origem_id: string | null;
  anonimizado_em: string | null;
  criado_em: string;
};

export type Interacao = {
  id: string;
  contato_id: string;
  atendente_id: string;
  chip_id: string;
  etapa: EtapaMsg;
  /** Qual candidato, nas etapas de candidato. Nulo na permissão e na saída. */
  candidato_id: string | null;
  variacao_id: string | null;
  texto_enviado: string | null;
  aberto_wa_em: string | null;
  resultado: StatusContato | null;
  resultado_em: string | null;
  dia_operacional: string;
  criado_em: string;
};

export type Modelo = { id: string; etapa: EtapaMsg; nome: string; ativo: boolean; atualizado_em: string };
export type Variacao = { id: string; modelo_id: string; texto: string; ordem: number; ativa: boolean; criado_em: string };
/**
 * Link rastreado. Aponta para exatamente UM alvo:
 * uma peça (`material_id`) ou a página de material do candidato (`candidato_id`).
 */
export type Link = {
  token: string;
  contato_id: string;
  material_id: string | null;
  candidato_id: string | null;
  criado_em: string;
};

export type Alerta = {
  id: number;
  tipo: string;
  chip_id: string | null;
  atendente_id: string | null;
  /**
   * O cadastro que originou o alerta, quando há um. É o que dá ao gestor um
   * botão em vez de um texto solto: sem ele, "número bloqueado tentou voltar"
   * seria um aviso sobre o qual não dá para agir.
   */
  captacao_id: string | null;
  /**
   * O contato que originou o alerta. Hoje só o pedido de revisão de um
   * "Pediu saída" o usa — é ele que dá ao gestor um botão que devolve a pessoa
   * para a conversa em vez de um texto sobre o qual não dá para agir.
   */
  contato_id: string | null;
  detalhe: string | null;
  resolvido_em: string | null;
  criado_em: string;
};

export type Captacao = {
  id: string;
  origem: OrigemContato;
  nome: string | null;
  telefone_e164: string | null;
  chave_dedup: string | null;
  /**
   * Pseudônimo do telefone. Sobrevive à purga de 48h, e é por ele que a purga
   * alcança esta linha e que o gestor liga um cadastro à lista de bloqueio.
   */
  telefone_hmac: string | null;
  municipio_id: number | null;
  /** A linha montada a partir das partes. É o que os relatórios leem. */
  endereco: string | null;
  /** 8 dígitos, sem hífen. Nulo quando a pessoa não soube o CEP. */
  cep: string | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  tamanho_camiseta: string | null;
  itens: string[] | null;
  /** De qual candidatura veio o cadastro. Nulo nas páginas genéricas. */
  candidato_id: string | null;
  /** A frase que a pessoa marcou, copiada no ato. É a prova do que foi aceito. */
  texto_aceite: string | null;
  entregue_em: string | null;
  entregue_por: string | null;
  entrega_obs: string | null;
  cancelado_em: string | null;
  cancelado_por: string | null;
  aceite_em: string;
  ip: string | null;
  user_agent: string | null;
  virou_contato: boolean;
  contato_id: string | null;
  criado_em: string;
};

// ── Candidatos ───────────────────────────────────────────────────────────────

export type CargoEleitoral =
  | 'presidente' | 'governador' | 'senador'
  | 'deputado_federal' | 'deputado_estadual' | 'deputado_distrital';

/** Quantos dígitos o número de urna tem em cada cargo. Igual à cola do eleitor. */
export const DIGITOS_DO_CARGO: Record<CargoEleitoral, number> = {
  presidente: 2, governador: 2, senador: 3,
  deputado_federal: 4, deputado_estadual: 5, deputado_distrital: 5,
};

export const ROTULO_CARGO: Record<CargoEleitoral, string> = {
  presidente: 'Presidente',
  governador: 'Governador',
  senador: 'Senador',
  deputado_federal: 'Deputado federal',
  deputado_estadual: 'Deputado estadual',
  deputado_distrital: 'Deputado distrital',
};

export type Candidato = {
  id: string;
  slug: string;
  nome_urna: string;
  nome_completo: string | null;
  cargo: CargoEleitoral;
  /** Só senador usa 2. É o que permite atender duas candidaturas ao Senado. */
  vaga: number;
  numero: string;
  uf: string | null;
  partido_sigla: string | null;
  partido_numero: string | null;
  coligacao: string | null;
  cnpj_campanha: string | null;
  responsavel_material: string | null;
  cor_tema: string | null;
  /** Fundo da página pública. Nulo = o padrão do sistema. */
  cor_fundo: string | null;
  /** Cartão e campos do formulário na página pública. */
  cor_superficie: string | null;
  /** Imagem de fundo, em WebP, no armazenamento do projeto. */
  fundo_url: string | null;
  /** Como a página pública se apresenta: seguir o aparelho, clara ou escura. */
  tema: 'auto' | 'claro' | 'escuro';
  foto_url: string | null;
  slogan: string | null;
  chamada: string | null;
  propostas: string | null;
  ativo: boolean;
  criado_em: string;
};

export type TipoMaterial = 'santinho' | 'propostas' | 'video' | 'canal' | 'site' | 'outro';

export type Material = {
  id: string;
  candidato_id: string;
  titulo: string;
  descricao: string | null;
  url: string;
  tipo: TipoMaterial;
  ordem: number;
  ativo: boolean;
  criado_em: string;
};

/**
 * A chapa de um atendente. A regra "um candidato por cargo, dois senadores"
 * é garantida no banco por `unique (atendente_id, cargo, vaga)`.
 */
export type AtendenteCandidato = {
  atendente_id: string;
  candidato_id: string;
  cargo: CargoEleitoral;
  vaga: number;
  /** O citado na primeira mensagem. No máximo um por atendente. */
  principal: boolean;
  criado_em: string;
};

/** Trilha de quem recebeu material de qual candidato, e quando. */
export type ContatoCandidato = {
  contato_id: string;
  candidato_id: string;
  material_enviado_em: string | null;
  atendente_id: string | null;
  chip_id: string | null;
  criado_em: string;
};

/**
 * O que ainda falta entregar a um contato, candidato por candidato.
 * Sai de `contato_candidato` — a lista congelada na permissão, não a chapa
 * atual do atendente.
 */
export type EntregaDoContato = {
  candidato_id: string;
  nome_urna: string;
  cargo: CargoEleitoral;
  numero: string;
  partido_sigla: string | null;
  ativo: boolean;
  principal: boolean;
  material_enviado_em: string | null;
  /** Peças ativas. Zero significa mensagem que anuncia material e não traz link. */
  materiais: number;
  /** Peças do tipo 'canal'. Zero desabilita o convite. */
  canais: number;
};

// ── Suporte ──────────────────────────────────────────────────────────────────

export const MOTIVOS_CHAMADO = ['tecnico', 'contato', 'juridico', 'material', 'outro'] as const;
export type MotivoChamado = (typeof MOTIVOS_CHAMADO)[number];

export const STATUS_CHAMADO = ['aberto', 'em_analise', 'resolvido'] as const;
export type StatusChamado = (typeof STATUS_CHAMADO)[number];

export const ROTULO_MOTIVO: Record<MotivoChamado, string> = {
  tecnico: 'Problema técnico',
  contato: 'Sobre um contato',
  juridico: 'Risco jurídico',
  material: 'Material ou texto',
  outro: 'Outro assunto',
};

/** O que cada motivo quer dizer, na tela de quem abre o chamado. */
export const DICA_MOTIVO: Record<MotivoChamado, string> = {
  tecnico: 'O painel travou, a extensão não abre, o WhatsApp Web deu problema.',
  contato: 'Algo sobre uma pessoa específica da sua fila.',
  juridico: 'Intimação, ameaça de denúncia, advogado, ou alguém dizendo que vai processar.',
  material: 'Link quebrado, peça errada, texto com problema.',
  outro: 'Qualquer outra coisa que o gestor precise saber.',
};

export const ROTULO_STATUS_CHAMADO: Record<StatusChamado, string> = {
  aberto: 'Aberto',
  em_analise: 'Em análise',
  resolvido: 'Resolvido',
};

export type Chamado = {
  id: string;
  atendente_id: string;
  motivo: MotivoChamado;
  assunto: string;
  contato_id: string | null;
  chip_id: string | null;
  status: StatusChamado;
  criado_em: string;
  respondido_em: string | null;
  resolvido_em: string | null;
  resolvido_por: string | null;
};

export type ChamadoMensagem = {
  id: string;
  chamado_id: string;
  autor_id: string | null;
  texto: string;
  criado_em: string;
};

export type ChamadoAnexo = {
  id: string;
  chamado_id: string;
  mensagem_id: string | null;
  autor_id: string | null;
  /** Caminho dentro do balde PRIVADO `suporte`. Nunca vira URL pública. */
  caminho: string;
  bytes: number;
  largura: number | null;
  altura: number | null;
  criado_em: string;
};

/** Uma linha da lista de chamados. */
export type ChamadoNaLista = {
  id: string;
  motivo: MotivoChamado;
  assunto: string;
  status: StatusChamado;
  criado_em: string;
  respondido_em: string | null;
  resolvido_em: string | null;
  atendente_id: string;
  atendente: string | null;
  contato_id: string | null;
  contato: string | null;
  contato_telefone: string | null;
  chip: string | null;
  mensagens: number;
  anexos: number;
  ultima_em: string | null;
  /** A última fala foi do atendente: a bola está com o gestor. */
  espera_gestor: boolean | null;
};

// ── Views ────────────────────────────────────────────────────────────────────

export type Resumo = {
  na_fila: number; fila_quente: number; fila_fria: number; em_atendimento: number;
  abordados: number; autorizou: number; pediu_saida: number; sem_resposta: number;
  perdidos: number; cliques_reais: number; abordados_hoje: number; alertas_abertos: number;
  chamados_abertos: number; juridicos_abertos: number;
};

export type SaudeChip = {
  chip_id: string; rotulo: string; status: StatusChip; papel: PapelChip;
  atendente_id: string | null; atendente: string | null;
  ultimas_abordagens: number; saidas: number; invalidos: number;
  autorizou: number; com_clique: number;
  pct_saida: number | null; pct_invalido: number | null;
  pct_sem_resposta: number | null; pct_clique: number | null;
  farol: 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';
  /**
   * Conversas distintas na última hora. É o quarto sinal do termômetro de
   * docs/03-OPERACAO.md §7 — o único que é medida direta, e por isso o único
   * que acende o farol mesmo num chip ainda sem histórico.
   */
  conversas_hora: number;
};

export type DesempenhoAtendente = {
  atendente_id: string; atendente: string; ativo: boolean;
  hoje: number; total_abordados: number; autorizou: number; pediu_saida: number;
  invalido: number; quer_ajudar: number; sem_resposta: number; cliques_reais: number;
};

/** Uma linha da fila de entrega de material impresso. */
export type Entrega = {
  id: string;
  nome: string | null;
  telefone_e164: string | null;
  municipio: string | null;
  endereco: string | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  tamanho_camiseta: string | null;
  itens: string[] | null;
  pedido_em: string;
  entregue_em: string | null;
  entregue_por: string | null;
  cancelado_em: string | null;
  cancelado_por: string | null;
  entrega_obs: string | null;
  candidato: string | null;
  contato_id: string | null;
  status_contato: StatusContato | null;
  atendente: string | null;
  estado: 'pendente' | 'entregue' | 'cancelado';
};

/** Uma linha da tela de contatos do gestor. */
export type ContatoDoGestor = {
  id: string;
  nome: string | null;
  primeiro_nome: string | null;
  telefone_e164: string | null;
  origem: OrigemContato;
  status: StatusContato;
  municipio_id: number | null;
  municipio: string | null;
  atendente_id: string | null;
  atendente: string | null;
  chip: string | null;
  candidato_origem_id: string | null;
  candidato_origem: string | null;
  lista: string | null;
  primeiro_contato_em: string | null;
  resultado_em: string | null;
  criado_em: string;
  encaminhamento: string | null;
  anonimizado_em: string | null;
  claim_expira_em: string | null;
  adiado_ate: string | null;
  mensagens: number;
  materiais_enviados: number;
  cliques: number;
  kit_pendente: boolean;
};

/** O que está EM ABERTO na mão de cada atendente. */
export type CargaAtendente = {
  atendente_id: string;
  atendente: string;
  ativo: boolean;
  na_mao_agora: number;
  aguardando_resposta: number;
  abertos_sem_falar: number;
  ultima_conversa: string | null;
};

export type CaptacaoPorCandidato = {
  candidato_id: string; nome_urna: string; slug: string;
  cadastros: number; pediram_kit: number; viraram_contato: number;
  receberam_material: number; ultimo_em: string | null;
};

export type LeadOrfao = {
  candidato_id: string; nome_urna: string; slug: string; na_fila: number;
};

export type FunilMunicipio = {
  municipio: string; contatos: number; autorizou: number;
  pediu_saida: number; quer_ajudar: number; cliques_reais: number;
};

// ── Retorno das RPCs ─────────────────────────────────────────────────────────

export type FilaStatus = {
  pode: boolean;
  motivo: MotivoFila;
  segundos_espera: number;
  dia_rampa: number;
  teto_hoje: number;
  enviados_hoje: number;
  restante_hoje: number;
  intervalo_seg: number;
  hora_local: number;
  hora_inicio: number;
  hora_fim: number;
  quentes_na_fila: number;
  frios_na_fila: number;
  em_atendimento_id: string | null;
};

export type ContatoDaFila = {
  id: string;
  nome: string | null;
  primeiro_nome: string | null;
  telefone_e164: string;
  origem: OrigemContato;
  status: StatusContato;
  municipio: string | null;
  municipio_id: number | null;
  claim_expira_em: string;
};

export type RespostaFila =
  | { ok: true; retomada: boolean; contato: ContatoDaFila; fila: FilaStatus }
  | { ok: false; motivo: MotivoFila; fila: FilaStatus };

export type RespostaAbertura =
  | { ok: true; ja_registrado: boolean; interacao_id: string; fila: FilaStatus }
  | { ok: false; motivo: string };

/** Por que `adicionar_contato` recusou. Cada um vira uma frase na tela. */
export type MotivoAdicionar =
  | 'usuario_inativo' | 'termo_nao_aceito' | 'chip_nao_e_seu' | 'chip_indisponivel'
  | 'telefone_invalido' | 'numero_bloqueado' | 'ja_e_de_outro_atendente'
  | 'numero_repetido';

export type RespostaAdicionarContato =
  | {
      ok: true;
      /** O número já estava na base — o cadastro reaproveitou a linha. */
      ja_existia: boolean;
      era_de_outro: boolean;
      contato: ContatoDaFila;
    }
  | {
      ok: false;
      motivo: MotivoAdicionar;
      /** Primeiro nome de quem já atende esse número, em 'ja_e_de_outro_atendente'. */
      atendente?: string;
      /** Por que o telefone não serve, em 'telefone_invalido'. */
      detalhe?: string;
    };

export type RespostaResultado =
  | { ok: true; status: Resultado }
  | { ok: false; motivo: string };

/** Mensagens em português para cada motivo de trava. */
export const TEXTO_MOTIVO: Record<MotivoFila, string> = {
  ok: 'Tudo certo.',
  termo_nao_aceito: 'Você precisa aceitar o termo de uso antes de começar.',
  usuario_inativo: 'Sua conta está inativa. Fale com o gestor.',
  chip_nao_e_seu: 'Esse número não está no seu cadastro. Fale com o gestor.',
  chip_indisponivel: 'Seu número está pausado. Abra o atalho do outro chip ou fale com o gestor.',
  dia_bloqueado: 'Hoje não se fala com ninguém. Bom descanso.',
  fora_de_horario: 'Fora do horário de atendimento.',
  teto_atingido: 'Você já fez todas as conversas de hoje. Pare por aqui.',
  intervalo: 'Aguarde o intervalo entre conversas.',
  fila_vazia: 'Não há mais contatos na fila.',
};
