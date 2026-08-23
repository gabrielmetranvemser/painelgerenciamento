/**
 * Qual item do menu está ativo, dado o caminho atual.
 *
 * ⚠️ Não é `startsWith`. Com `/{chave}/gestor` e `/{chave}/gestor/contatos` na
 * mesma lista, o prefixo casa nos DOIS — e o menu acendia "Visão geral" junto
 * com a aba de verdade em toda tela do gestor.
 *
 * Vence o casamento mais LONGO: o item mais específico é o que descreve onde a
 * pessoa está.
 */
export function itemAtivo(caminho: string, hrefs: string[]): string | null {
  let melhor: string | null = null;
  for (const href of hrefs) {
    if (caminho !== href && !caminho.startsWith(`${href}/`)) continue;
    if (melhor === null || href.length > melhor.length) melhor = href;
  }
  return melhor;
}
