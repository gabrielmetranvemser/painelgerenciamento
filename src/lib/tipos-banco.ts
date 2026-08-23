/**
 * Tipos do banco.
 *
 * Escritos à mão porque `supabase gen types` exige Docker e esta máquina não
 * tem. Se você alterar uma migration, atualize aqui também — ou rode
 * `supabase gen types typescript --db-url "$SUPABASE_DB_URL"` numa máquina com
 * Docker e substitua o arquivo.
 */

export type OrigemContato = 'site' | 'kit' | 'lista_fria';

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
  candidato: string;
  cargo: string;
  numero: string;
  termo_texto: string;
  termo_versao: number;
  material_titulo: string;
  material_texto: string;
  kit_ativo: boolean;
  responsavel_dados: string;
  atualizado_em: string;
};

export type Municipio = { id: number; uf: string; nome: string };
export type DiaBloqueado = { data: string; motivo: string; criado_em: string };

export type Usuario = {
  id: string;
  papel: PapelUsuario;
  primeiro_nome: string;
  ativo: boolean;
  termo_aceito_em: string | null;
  termo_versao: number | null;
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
  primeiro_contato_em: string | null;
  resultado_em: string | null;
  encaminhamento: string | null;
  anonimizado_em: string | null;
  criado_em: string;
};

export type Interacao = {
  id: string;
  contato_id: string;
  atendente_id: string;
  chip_id: string;
  etapa: EtapaMsg;
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
export type Destino = { id: string; chave: string; nome: string; url: string; atualizado_em: string };
export type Link = { token: string; contato_id: string; destino_id: string; criado_em: string };

export type Alerta = {
  id: number;
  tipo: string;
  chip_id: string | null;
  atendente_id: string | null;
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
  municipio_id: number | null;
  endereco: string | null;
  itens: string[] | null;
  aceite_em: string;
  ip: string | null;
  user_agent: string | null;
  virou_contato: boolean;
  contato_id: string | null;
  criado_em: string;
};

// ── Views ────────────────────────────────────────────────────────────────────

export type Resumo = {
  na_fila: number; fila_quente: number; fila_fria: number; em_atendimento: number;
  abordados: number; autorizou: number; pediu_saida: number; sem_resposta: number;
  perdidos: number; cliques_reais: number; abordados_hoje: number; alertas_abertos: number;
};

export type SaudeChip = {
  chip_id: string; rotulo: string; status: StatusChip; papel: PapelChip;
  atendente_id: string | null; atendente: string | null;
  ultimas_abordagens: number; saidas: number; invalidos: number;
  autorizou: number; com_clique: number;
  pct_saida: number | null; pct_invalido: number | null;
  pct_sem_resposta: number | null; pct_clique: number | null;
  farol: 'verde' | 'amarelo' | 'vermelho' | 'sem_dados';
};

export type DesempenhoAtendente = {
  atendente_id: string; atendente: string; ativo: boolean;
  hoje: number; total_abordados: number; autorizou: number; pediu_saida: number;
  invalido: number; quer_ajudar: number; sem_resposta: number; cliques_reais: number;
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
