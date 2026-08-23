/**
 * Detecção de pré-carregamento automático nos links rastreados.
 *
 * ⚠️ FUNÇÃO CRÍTICA — não alterar sem rodar `npm test`.
 *
 * POR QUE ISTO EXISTE
 * -------------------
 * O clique no link é a única métrica que o sistema controla de verdade e a prova
 * de consentimento que a defesa jurídica usa (docs/01-VISAO-GERAL.md §8).
 *
 * Só que, no instante em que o atendente envia a mensagem, o WhatsApp busca a
 * URL sozinho para montar a pré-visualização. Sem filtro, TODO contato apareceria
 * como "clicou" no segundo seguinte ao envio — a métrica mais confiável do
 * projeto viraria ruído de 100%.
 *
 * Então: registramos todo acesso em `cliques` (inclusive os automáticos, que são
 * úteis para depurar), mas com a coluna `is_bot`. Todo relatório conta apenas
 * `is_bot = false`.
 */

/**
 * Assinaturas de user-agent que indicam busca automática, não uma pessoa.
 * A primeira linha é a que mais importa: são os pré-carregadores de preview.
 */
const ASSINATURAS_BOT: readonly RegExp[] = [
  // pré-visualização de link em mensageiros e redes
  /whatsapp/i,
  /facebookexternalhit|facebookcatalog|facebot|meta-externalagent/i,
  /telegrambot/i,
  /twitterbot/i,
  /slackbot|slack-imgproxy/i,
  /discordbot/i,
  /linkedinbot/i,
  /skypeuripreview/i,
  /redditbot/i,
  /pinterest/i,
  /vkshare/i,
  /embedly|iframely|quora link preview|outbrain/i,
  /snapchat/i,
  /tiktok/i,
  // buscadores
  /googlebot|google-inspectiontool|adsbot-google|mediapartners-google/i,
  /bingbot|bingpreview|msnbot/i,
  /yandex(bot|images)/i,
  /duckduckbot|baiduspider|applebot|petalbot|sogou/i,
  // clientes automatizados e varredores de segurança
  /\bcurl\/|\bwget\/|python-requests|python-urllib|go-http-client|okhttp/i,
  /axios\/|node-fetch|got \(|libwww-perl|java\/|apache-httpclient/i,
  /headlesschrome|phantomjs|puppeteer|playwright|selenium/i,
  /uptimerobot|pingdom|statuscake|site24x7|newrelicpinger/i,
  // genéricos, por último (mais amplos, mais chance de falso positivo)
  /\bbot\b|\bbots\b|crawler|spider|scraper|preview|monitoring|validator/i,
];

export type OrigemAcesso = {
  userAgent: string | null | undefined;
  /** método HTTP da requisição */
  metodo?: string;
};

/**
 * `true` quando o acesso ao link foi feito por máquina, não por pessoa.
 *
 * Regras, em ordem:
 *   1. HEAD nunca é gente — navegador não navega com HEAD.
 *   2. User-agent vazio é máquina. Todo navegador real manda um.
 *   3. Bate contra as assinaturas conhecidas.
 *
 * Erra para o lado seguro: preferimos marcar um clique real como bot (métrica
 * conservadora) a inflar o número de cliques e enganar o gestor na decisão de
 * pausar ou não um chip.
 */
export function ehAcessoAutomatico({ userAgent, metodo }: OrigemAcesso): boolean {
  if (metodo && metodo.toUpperCase() === 'HEAD') return true;

  const ua = (userAgent ?? '').trim();
  if (ua.length === 0) return true;

  return ASSINATURAS_BOT.some((re) => re.test(ua));
}
