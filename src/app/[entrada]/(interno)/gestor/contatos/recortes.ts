/**
 * Os recortes da tela de Contatos, e a forma dos filtros.
 *
 * ⚠️ ESTE ARQUIVO NÃO PODE TER `'use client'`, e é justamente por isso que ele
 * existe separado da tabela.
 *
 * `RECORTES` estava dentro de `tabela.tsx`, que é um componente de cliente, e a
 * página — que roda no servidor — importava de lá para validar o `?recorte=` da
 * URL. Compila, passa no typecheck, sobe... e derruba a tela em produção com
 * `RECORTES.some is not a function`.
 *
 * O motivo: tudo que um módulo `'use client'` exporta vira, do lado do
 * servidor, uma REFERÊNCIA para o cliente — não o valor. Componente funciona
 * assim de propósito (é o que o servidor manda o navegador montar), mas um
 * array vira um objeto que não é array, e `.some` não existe nele.
 *
 * Regra que cai daí: **Server Component só importa COMPONENTE de arquivo
 * `'use client'`.** Constante, função auxiliar e tabela de dados moram num
 * arquivo neutro como este, que os dois lados podem importar. Tipo pode ficar
 * em qualquer lugar — tipo some na compilação.
 */

/**
 * Atalhos de leitura, na ordem em que o gestor pergunta.
 *
 * "Pendente" não é um status do banco: é a pergunta que o gestor faz de manhã —
 * quem já foi chamado e ainda não deu resposta. No banco isso é
 * `em_atendimento` com a primeira mensagem já enviada.
 *
 * ⚠️ As chaves são as mesmas que `contatos_do_gestor` conhece. Acrescentar uma
 * aqui sem acrescentar lá faz a aba nova cair silenciosamente em "todos".
 */
export const RECORTES = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'pendentes', rotulo: 'Aguardando resposta' },
  { chave: 'na_fila', rotulo: 'Ainda não chamados' },
  { chave: 'autorizou', rotulo: 'Autorizaram' },
  { chave: 'pediu_saida', rotulo: 'Pediram saída' },
  { chave: 'kit', rotulo: 'Kit a entregar' },
  // ⚠️ Só os NÃO tratados. "Encaminhar" grava o pedido da pessoa em
  // `contatos.encaminhamento` e o atendente responde "vou levar sua pergunta
  // pra equipe" — mas o texto só chegava ao gestor pelo CSV, e na prática
  // morria no banco. Esta aba é o outro lado da promessa.
  { chave: 'encaminhados', rotulo: 'Encaminhados' },
] as const;

export type Recorte = (typeof RECORTES)[number]['chave'];
export type Contagens = Record<Recorte, number>;

export type Filtros = {
  recorte: Recorte;
  atendente: string;
  candidato: string;
  municipio: string;
  origem: string;
  /** Id da lista, ou `'sem'` para quem não veio de lista nenhuma. */
  lista: string;
  busca: string;
};

/** `true` quando o valor veio da URL e é mesmo um recorte que a tela conhece. */
export function ehRecorte(valor: string | undefined): valor is Recorte {
  return RECORTES.some((r) => r.chave === valor);
}
