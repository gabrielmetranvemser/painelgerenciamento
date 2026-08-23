import 'server-only';

/**
 * O endereço público da aplicação, para montar os links que vão nas mensagens.
 *
 * ⚠️ Nunca devolve string vazia por omissão.
 *
 * Antes isto era `process.env.LINK_BASE_URL ?? ''`, e num ambiente sem a
 * variável o link da mensagem saía `/r/abc123` — texto morto dentro de uma
 * conversa de WhatsApp. O atendente mandava, a pessoa não conseguia abrir, e
 * ninguém descobria: o sistema registrava o envio normalmente e o clique
 * simplesmente nunca chegava.
 *
 * Agora, sem endereço, quem falha é a montagem da mensagem — com motivo. É
 * melhor o atendente ver "fale com o gestor" do que a pessoa receber um link
 * que não abre.
 */
export function enderecoBase(): string | null {
  const explicito = process.env.LINK_BASE_URL?.trim();
  if (explicito) return semBarraFinal(explicito);

  // A Vercel injeta estas duas sozinha. A primeira é o domínio de produção
  // (estável); a segunda é o do deploy atual, que serve para pré-visualização.
  const producao = process.env.VERCEL_PROJECT_PRODUCTION_URL?.trim();
  if (producao) return `https://${semBarraFinal(producao)}`;

  const deploy = process.env.VERCEL_URL?.trim();
  if (deploy) return `https://${semBarraFinal(deploy)}`;

  return null;
}

function semBarraFinal(url: string): string {
  return url.replace(/\/+$/, '');
}
