import 'server-only';

/**
 * O que as duas rotas de imagem da marca combinam.
 *
 * ⚠️ Este arquivo NÃO é rota: ele é vizinho das duas (`cartao/` e `icone/`)
 * porque só elas o usam. Nome sem `route`, então o roteador do Next não o
 * confunde com um endereço.
 */

/**
 * O 404 daqui é o 404 de todo o resto: corpo vazio, sem mensagem.
 *
 * Candidato inexistente, candidato desativado e endereço antigo de quem já tem
 * domínio próprio devolvem a MESMA resposta — de fora não dá para separar as
 * três, que é a regra que vale no sistema inteiro.
 */
export function naoExiste(): Response {
  return new Response(null, { status: 404 });
}

/**
 * Guardar por muito tempo é seguro porque a URL carrega `?v=`: mudou a logo ou
 * a cor, muda o carimbo e o endereço é outro. Sem o carimbo isto seria um tiro
 * no pé — a campanha trocaria a marca e a CDN continuaria servindo a antiga por
 * uma semana.
 *
 * `s-maxage` alto tira a geração do caminho de quem clica: a primeira visita
 * paga o desenho, o resto do dia sai da borda.
 */
export const CABECALHOS_DA_MARCA: [string, string][] = [
  ['cache-control', 'public, max-age=3600, s-maxage=86400, stale-while-revalidate=604800'],
];
