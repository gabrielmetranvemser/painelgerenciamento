/**
 * Os recortes de "Meus contatos", e a forma dos filtros.
 *
 * ⚠️ ESTE ARQUIVO NÃO PODE TER `'use client'`, e é por isso que ele existe
 * separado da lista. A página roda no SERVIDOR e precisa destes valores para
 * validar o `?status=` da URL; tudo que um módulo `'use client'` exporta chega
 * ao servidor como REFERÊNCIA, não como valor — um array vira um objeto que não
 * é array, e `.some` deixa de existir. Foi assim que `RECORTES.some is not a
 * function` derrubou a tela de Contatos em produção. Ver
 * `gestor/contatos/recortes.ts` e a regra 3.1 do CLAUDE.md.
 */

import { RESULTADOS, type StatusContato } from '@/lib/tipos-banco';

/**
 * Os desfechos que podem aparecer na lista de um atendente, na ordem em que ele
 * pergunta por eles.
 *
 * `em_atendimento` vem primeiro porque é a pergunta que ele faz ao abrir a
 * tela: "quem ainda está me devendo resposta?". `falar_depois` vem logo
 * depois — é a agenda dele.
 *
 * Sai de `RESULTADOS` em vez de ser uma lista escrita à mão: desfecho novo
 * aparece aqui sozinho, e não fica um recorte faltando por esquecimento.
 */
export const STATUS_MEUS_CONTATOS: readonly StatusContato[] = [
  'em_atendimento',
  'falar_depois',
  ...RESULTADOS.filter((r) => r !== 'falar_depois'),
  'perdido',
];

/** `true` quando o valor veio da URL e é mesmo um recorte que a tela conhece. */
export function ehStatus(valor: string | undefined): valor is StatusContato {
  return STATUS_MEUS_CONTATOS.some((s) => s === valor);
}

/** Uma linha da lista. É o que `meus_contatos` devolve. */
export type MeuContato = {
  id: string;
  nome: string | null;
  primeiro_nome: string | null;
  telefone_e164: string | null;
  origem: 'site' | 'kit' | 'lista_fria' | 'chamou';
  status: StatusContato;
  municipio: string | null;
  primeiro_contato_em: string | null;
  resultado_em: string | null;
  /** Quando o "Falar depois" volta para a fila. */
  adiado_ate: string | null;
  /**
   * A hora do reagendamento já chegou.
   *
   * ⚠️ Vem PRONTA do servidor, e não de um `Date.now()` na tela. Quem decide se
   * o contato voltou para a fila é a própria fila, que roda no Postgres em UTC:
   * um notebook com o relógio adiantado mostraria "já pode falar" para um
   * contato que `pegar_proximo_contato` ainda recusa.
   */
  pode_falar: boolean;
  anonimizado_em: string | null;
  encaminhamento: string | null;
};

export type RespostaMeusContatos = {
  /** status → quantos. A tela monta as abas a partir daqui. */
  contagens: Partial<Record<StatusContato, number>>;
  /** O total sem recorte, para a aba "Todos". */
  todos: number;
  /** O total DENTRO do recorte, para a paginação. */
  total: number;
  linhas: MeuContato[];
};
