/**
 * Os números da tela de Desempenho por atendente.
 *
 * ⚠️ Arquivo NEUTRO (sem `server-only`, sem `'use client'`) porque a página é
 * Server Component e os gráficos são desenhados no servidor, mas as tabelas de
 * rótulo e os agrupamentos precisam poder ser importados dos dois lados. Ver
 * CLAUDE.md §3.1: constante exportada de módulo `'use client'` chega ao
 * servidor como referência, não como valor — e `.map` deixa de existir.
 *
 * ⚠️ QUEM CALCULA É O BANCO. `relatorio_de_atendimento` devolve tudo somado.
 * Este arquivo só nomeia, agrupa e formata. A tentação de puxar as interações
 * e contar aqui tem um preço conhecido: o PostgREST corta em 1.000 linhas sem
 * avisar, e a base já tem 6.275 interações — a tela mostraria número errado
 * com cara de certo, que foi exatamente o defeito da tela de Contatos antiga.
 */
import { ROTULO_STATUS_CONTATO, type StatusContato } from './tipos-banco';

/* ── O que a RPC devolve ────────────────────────────────────────────────── */

export type PeriodoDoRelatorio = {
  /** Zero quer dizer "desde o começo". */
  dias: number;
  desde: string;
  ate: string;
};

export type LinhaDaEquipe = {
  atendente_id: string;
  atendente: string;
  ativo: boolean;
  foto_url: string | null;
  /** Vezes que clicou em "Abrir conversa". Uma pessoa rende várias. */
  aberturas: number;
  /** Pessoas distintas com quem falou. É o número de "abordou". */
  pessoas: number;
  dias_trabalhados: number;
  /** Horas distintas com pelo menos uma conversa aberta, somadas no período. */
  horas_ativas: number;
  positivos: number;
  autorizou: number;
  negativos: number;
  sem_resposta: number;
  em_aberto: number;
  cliques: number;
  /** ⚠️ Estes três são AGORA, não o período. */
  na_mao_agora: number;
  aguardando_resposta: number;
  abertos_sem_falar: number;
};

export type DiaDeAtendimento = { dia: string; aberturas: number; pessoas: number };
export type HoraDoDia = { hora: number; aberturas: number };

export type JornadaDoDia = {
  dia: string;
  /** Minutos desde a meia-noite, no fuso da operação. */
  inicio: number;
  fim: number;
  horas_ativas: number;
  aberturas: number;
  pessoas: number;
};

export type EtapaDoAtendimento = { etapa: string; aberturas: number; pessoas: number };
export type DesfechoDoAtendimento = { resultado: string; pessoas: number };

export type RelatorioDeAtendimento = {
  periodo: PeriodoDoRelatorio;
  equipe: LinhaDaEquipe[];
  dias: DiaDeAtendimento[];
  horas: HoraDoDia[];
  jornada: JornadaDoDia[];
  etapas: EtapaDoAtendimento[];
  desfechos: DesfechoDoAtendimento[];
};

/* ── O período ──────────────────────────────────────────────────────────── */

export const PERIODOS = [
  { dias: 7, rotulo: '7 dias' },
  { dias: 30, rotulo: '30 dias' },
  { dias: 90, rotulo: '90 dias' },
  { dias: 0, rotulo: 'Tudo' },
] as const;

/**
 * O `?dias=` da URL, ou 30.
 *
 * Fechado na lista de propósito: `?dias=100000` sai daqui como 30. O período é
 * o divisor de quase tudo nesta tela, e um valor que o servidor aceita mas a
 * barra de botões não sabe desenhar deixaria a tela sem nenhum botão marcado —
 * o gestor olhando um recorte sem saber qual é.
 */
export function periodoEscolhido(bruto: string | undefined): number {
  // ⚠️ O `trim()` vazio sai antes do `Number`, e não por capricho: `Number('')`
  // é 0, e 0 é um período de verdade aqui — "tudo". Um `?dias=` sem valor,
  // vindo de um formulário ou de um link cortado, abriria o histórico inteiro
  // em vez do padrão de 30 dias, e a tela pareceria certa.
  const texto = (bruto ?? '').trim();
  if (!texto) return 30;
  const n = Number(texto);
  return PERIODOS.some((p) => p.dias === n) ? n : 30;
}

/* ── Os quatro grupos de desfecho ───────────────────────────────────────── */

export type GrupoDeDesfecho = 'positivos' | 'negativos' | 'sem_resposta' | 'em_aberto';

/**
 * ⚠️ A mesma divisão que a RPC faz, e ela não é opinião de tela: "positivo" é
 * o que a campanha queria da conversa, "negativo" é o que fecha a porta, e o
 * resto ainda não terminou. Trocar a lista aqui sem trocar lá faz o gráfico
 * discordar do número que está logo acima dele.
 */
export const GRUPOS_DE_DESFECHO: {
  chave: GrupoDeDesfecho; rotulo: string; cor: string; dica: string;
}[] = [
  {
    chave: 'positivos', rotulo: 'Deu certo', cor: 'var(--acento)',
    dica: 'Autorizou, quer ajudar ou já apoia.',
  },
  {
    chave: 'negativos', rotulo: 'Fechou a porta', cor: 'var(--perigo)',
    dica: 'Pediu saída, número inválido, não é a pessoa ou mudou de estado.',
  },
  {
    chave: 'sem_resposta', rotulo: 'Não respondeu', cor: 'var(--alerta)',
    dica: 'Foi abordada e não voltou.',
  },
  {
    chave: 'em_aberto', rotulo: 'Ainda aberto', cor: 'var(--tenue)',
    dica: 'Conversa em andamento, reagendada ou encaminhada.',
  },
];

/** Em que grupo cai cada situação de contato. Tipado pelo enum: valor novo vira erro de build. */
export const GRUPO_DO_STATUS: Record<StatusContato, GrupoDeDesfecho> = {
  autorizou: 'positivos',
  quer_ajudar: 'positivos',
  ja_apoia: 'positivos',
  pediu_saida: 'negativos',
  invalido: 'negativos',
  nao_e_a_pessoa: 'negativos',
  mudou_de_estado: 'negativos',
  sem_resposta: 'sem_resposta',
  em_atendimento: 'em_aberto',
  falar_depois: 'em_aberto',
  encaminhado: 'em_aberto',
  outro: 'em_aberto',
  na_fila: 'em_aberto',
  novo: 'em_aberto',
  perdido: 'em_aberto',
};

export function rotuloDoStatus(bruto: string): string {
  return ROTULO_STATUS_CONTATO[bruto as StatusContato] ?? bruto;
}

export function grupoDoStatus(bruto: string): GrupoDeDesfecho {
  return GRUPO_DO_STATUS[bruto as StatusContato] ?? 'em_aberto';
}

export function corDoStatus(bruto: string): string {
  const grupo = grupoDoStatus(bruto);
  return GRUPOS_DE_DESFECHO.find((g) => g.chave === grupo)!.cor;
}

/* ── Formatação ─────────────────────────────────────────────────────────── */

/** 970 → "16:10". Minutos desde a meia-noite, no fuso da operação. */
export function relogio(minutos: number): string {
  const m = Math.max(0, Math.min(24 * 60 - 1, Math.round(minutos)));
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/** 200 → "3h20". 45 → "45min". Para durações, não para horários. */
export function duracao(minutos: number): string {
  const m = Math.max(0, Math.round(minutos));
  if (m < 60) return `${m}min`;
  const h = Math.floor(m / 60);
  const resto = m % 60;
  return resto === 0 ? `${h}h` : `${h}h${String(resto).padStart(2, '0')}`;
}

/**
 * "2026-09-05" → "05/09".
 *
 * ⚠️ O `T12:00:00` não é enfeite. `new Date('2026-09-05')` é meia-noite em UTC,
 * que em Rondônia (UTC−4) ainda é dia 4 — todo rótulo do gráfico apareceria um
 * dia atrasado, e ninguém desconfia de um gráfico que só está deslocado.
 */
export function diaCurto(iso: string): string {
  const d = new Date(`${iso}T12:00:00`);
  return `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function diaPorExtenso(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('pt-BR', {
    weekday: 'short', day: '2-digit', month: '2-digit',
  });
}

/** Quantos por cento `parte` é de `total`. Sem total, zero — nunca NaN na tela. */
export function porcento(parte: number, total: number): number {
  return total > 0 ? (parte / total) * 100 : 0;
}

/** "12%" — inteiro, e "—" quando não há base para dividir. */
export function taxa(parte: number, total: number): string {
  return total > 0 ? `${Math.round((parte / total) * 100)}%` : '—';
}

export function numero(n: number): string {
  return n.toLocaleString('pt-BR');
}

/* ── Contas que a tela faz sobre o que veio do banco ────────────────────── */

/** Soma uma coluna da equipe. Serve para os cartões de cima quando é "todos". */
export function somar(equipe: LinhaDaEquipe[], campo: keyof LinhaDaEquipe): number {
  return equipe.reduce((s, l) => s + (typeof l[campo] === 'number' ? (l[campo] as number) : 0), 0);
}

/**
 * Quem trabalhou no período.
 *
 * ⚠️ O ranking mostra só quem apareceu. Quinze linhas em zero empurram para
 * fora da tela justamente as que o gestor abriu a página para ver, e "não
 * trabalhou no período" já é dito, em uma linha, embaixo do gráfico.
 */
export function quemTrabalhou(equipe: LinhaDaEquipe[]): LinhaDaEquipe[] {
  return equipe.filter((l) => l.pessoas > 0 || l.aberturas > 0);
}

/**
 * Média de conversas por dia trabalhado.
 *
 * ⚠️ Divide pelos dias em que a pessoa DE FATO abriu conversa, não pelos dias
 * do período. Dividir pelo período castiga quem entrou na equipe na semana
 * passada e premia quem trabalhou pouco todo dia — e o gestor usa este número
 * para comparar gente.
 */
export function porDiaTrabalhado(linha: LinhaDaEquipe): number {
  return linha.dias_trabalhados > 0 ? linha.pessoas / linha.dias_trabalhados : 0;
}
