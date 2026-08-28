/**
 * Os itens de material impresso que a pessoa pode pedir.
 *
 * ⚠️ ESTAVAM ESCRITOS À MÃO EM CINCO LUGARES: a validação do formulário
 * público, o próprio formulário, o botão de adicionar contato, o perfil do
 * contato e o rótulo da tela de entregas. Acrescentar "boné" era um deploy, e
 * esquecer um dos cinco era um item que aparece na tela e o servidor recusa.
 *
 * Agora a lista é cadastro (`itens_kit`) e este arquivo é só a forma dela.
 *
 * Arquivo NEUTRO de propósito: os dois lados importam daqui. Constante que sai
 * de um módulo `'use client'` chega ao servidor como referência, não como
 * valor — ver a regra 3.1 do CLAUDE.md.
 */

export type ItemKit = {
  /**
   * O que fica gravado em `captacoes.itens`. É para sempre: trocar a chave de
   * um item já pedido cria linha de relatório que ninguém consegue ler.
   */
  chave: string;
  rotulo: string;
  /** Pedir este item deve perguntar o tamanho da camiseta. */
  pede_tamanho: boolean;
};

/**
 * O que a tela mostra quando a consulta ao banco falhou.
 *
 * Não é "a lista": é o mínimo para o formulário não sair vazio num momento em
 * que ninguém está olhando. Sai com as mesmas chaves gravadas na base desde o
 * começo, então nada que entrar por aqui vira dado ilegível.
 */
export const ITENS_PADRAO: readonly ItemKit[] = [
  { chave: 'santinho', rotulo: 'Santinho', pede_tamanho: false },
  { chave: 'adesivo', rotulo: 'Adesivo de carro', pede_tamanho: false },
  { chave: 'camiseta', rotulo: 'Camiseta', pede_tamanho: true },
];

/**
 * O rótulo de um item, mesmo depois de ele ter sido desativado.
 *
 * Relatório antigo continua tendo de ser legível: um item que saiu do cadastro
 * ainda aparece nas entregas de quem pediu antes. Sem este `fallback`, a tela
 * mostraria a chave crua no meio de rótulos em português.
 */
export function rotuloDoItem(chave: string, itens: readonly ItemKit[]): string {
  return itens.find((i) => i.chave === chave)?.rotulo ?? chave;
}

/** Algum dos itens escolhidos pede o tamanho da camiseta? */
export function pedeTamanho(escolhidos: readonly string[], itens: readonly ItemKit[]): boolean {
  return escolhidos.some((c) => itens.find((i) => i.chave === c)?.pede_tamanho);
}
