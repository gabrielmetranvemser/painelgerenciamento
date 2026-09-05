/**
 * A marca do aparelho liberado.
 *
 * Um cookie assinado que diz "este navegador pode ver o painel". Sem ele, todo
 * caminho interno devolve 404 — a mesma resposta de um endereço que não existe.
 *
 * ⚠️ A VERIFICAÇÃO É SÓ CRIPTOGRAFIA, SEM IDA AO BANCO, e isso é de propósito.
 * Ela roda em TODA requisição interna, no proxy. Uma consulta ali seria um
 * ida-e-volta a mais em cada clique de atendente, o dia inteiro — e, pior,
 * transformaria uma instabilidade do banco em "o painel sumiu para todo mundo".
 * A revogação, que precisa do banco, é conferida no layout interno, que já
 * consulta o banco de qualquer jeito.
 *
 * ⚠️ A chave é DERIVADA de `HMAC_SECRET`, não é ela. Assim o cookie do aparelho
 * e o hash de telefone nunca produzem o mesmo valor a partir da mesma entrada,
 * e não existe um segredo novo para o gestor guardar. O preço é conhecido:
 * trocar a `HMAC_SECRET` desliga todos os aparelhos junto com a lista de
 * bloqueio — e trocá-la durante a campanha já é proibido (CLAUDE.md §5).
 *
 * Web Crypto, e não `node:crypto`: este módulo roda no proxy, que é Edge.
 */

export const COOKIE_APARELHO = 'painel_aparelho';

/** Um ano. O atendente não pode ser obrigado a repetir isto no meio da campanha. */
export const VALIDADE_DIAS = 365;

const ROTULO = 'aparelho-do-painel-v1';

async function chave(): Promise<CryptoKey> {
  const segredo = process.env.HMAC_SECRET;
  if (!segredo) throw new Error('HMAC_SECRET ausente: o aparelho não pode ser assinado.');

  const base = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(segredo),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
  const derivada = await crypto.subtle.sign('HMAC', base, new TextEncoder().encode(ROTULO));

  return crypto.subtle.importKey(
    'raw', derivada, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'],
  );
}

function base64url(bytes: ArrayBuffer): string {
  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** `{id}.{emitidoEm}.{assinatura}` — o valor que vai para o cookie. */
export async function assinarAparelho(id: string, agora = Date.now()): Promise<string> {
  const corpo = `${id}.${agora}`;
  const assinatura = await crypto.subtle.sign('HMAC', await chave(),
    new TextEncoder().encode(corpo));
  return `${corpo}.${base64url(assinatura)}`;
}

/**
 * O id do aparelho, ou `null` se o cookie não presta.
 *
 * Devolve `null` — nunca lança — para qualquer defeito: ausente, mal formado,
 * assinatura errada, vencido. Quem chama transforma isso em 404, e um erro
 * aqui viraria tela de erro, que já contaria que existe algo neste endereço.
 */
export async function lerAparelho(
  cookie: string | null | undefined,
  agora = Date.now(),
): Promise<string | null> {
  if (!cookie) return null;

  const partes = cookie.split('.');
  if (partes.length !== 3) return null;

  const [id, emitidoEm, assinatura] = partes;
  const quando = Number(emitidoEm);
  if (!id || !Number.isFinite(quando)) return null;

  // Vencido, ou emitido no futuro (relógio adulterado no cliente).
  if (agora - quando > VALIDADE_DIAS * 86_400_000 || quando > agora + 86_400_000) return null;

  try {
    const esperada = await crypto.subtle.sign('HMAC', await chave(),
      new TextEncoder().encode(`${id}.${emitidoEm}`));
    // Comparação de tamanho fixo. `===` em string sai no primeiro byte
    // diferente, e o tempo de resposta entrega quanto do valor está certo.
    return iguais(base64url(esperada), assinatura) ? id : null;
  } catch {
    return null;
  }
}

function iguais(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diferenca = 0;
  for (let i = 0; i < a.length; i += 1) diferenca |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diferenca === 0;
}

/** O hash do código do convite. O código em claro só existe na tela do gestor. */
export async function hashDoCodigo(codigo: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(codigo));
  return base64url(bytes);
}

/** Um código de convite: 160 bits, alfabeto de URL. */
export function gerarCodigo(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(20));
  return base64url(bytes.buffer as ArrayBuffer);
}
