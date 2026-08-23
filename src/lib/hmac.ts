import 'server-only';
import { createHmac, timingSafeEqual } from 'node:crypto';

/**
 * Pseudonimização do telefone para a lista de bloqueio (quem pediu saída).
 *
 * ⚠️ FUNÇÃO CRÍTICA — não alterar sem rodar `npm test`.
 * ⚠️ SÓ SERVIDOR. O `import 'server-only'` faz o build quebrar se algum
 *    componente cliente importar este arquivo por engano.
 *
 * O PROBLEMA QUE ISTO RESOLVE
 * ---------------------------
 * Prometemos apagar o número de quem pediu saída em até 48h (LGPD, e é o que a
 * mensagem de saída diz para a pessoa). Mas também prometemos nunca mais falar
 * com ela — inclusive se o mesmo número voltar numa importação futura.
 *
 * Guardar o número para poder bloqueá-lo contradiz o apagamento. A saída é
 * guardar só o HMAC: dá para verificar se um número está bloqueado sem manter
 * o número em lugar nenhum. A chave fica em variável de ambiente, nunca no
 * banco — então nem quem tiver um dump do Postgres consegue reverter os hashes.
 *
 * ONDE O HASH É GRAVADO
 * ---------------------
 * `contatos.telefone_hmac`, preenchido na importação. Assim a função de fila,
 * que roda dentro do Postgres, consegue filtrar bloqueados sem nunca ver a
 * chave secreta. Quando o cron apaga nome e telefone do contato em 48h, o
 * HMAC permanece — e o bloqueio sobrevive ao apagamento.
 *
 * ⚠️ TROCAR A HMAC_SECRET INVALIDA A LISTA DE BLOQUEIO INTEIRA.
 * Todos os hashes gravados viram lixo e as pessoas que pediram saída voltam
 * para a fila. Por isso gravamos `hmac_versao` junto: numa rotação futura dá
 * para manter as duas chaves e checar as duas versões durante a transição.
 * Não rotacionar no meio da campanha.
 */

/** Versão da chave em uso. Gravada junto com cada hash. */
export const HMAC_VERSAO_ATUAL = 1;

export type TelefoneHash = {
  hash: string;
  versao: number;
};

function segredo(): string {
  const s = process.env.HMAC_SECRET;
  if (!s || s.length < 32) {
    // Falhar alto e cedo. Um segredo ausente produziria hashes consistentes
    // entre si mas inúteis, e o bug só apareceria quando alguém bloqueado
    // voltasse para a fila — tarde demais.
    throw new Error(
      'HMAC_SECRET ausente ou curta demais (mínimo 32 caracteres). ' +
        'Gere com: openssl rand -hex 32',
    );
  }
  return s;
}

/**
 * Gera o HMAC de um telefone a partir da `chaveDedup` (DDD + 8 dígitos finais).
 *
 * Usamos a chaveDedup, e não o e164, de propósito: ela é a identidade real da
 * pessoa no sistema (as duas grafias do mesmo número colapsam nela). Hashear o
 * e164 daria o mesmo resultado prático, já que normalizamos antes, mas amarrar
 * o bloqueio à mesma chave que o UNIQUE INDEX usa elimina qualquer chance de as
 * duas checagens divergirem.
 */
export function hashTelefone(chaveDedup: string): TelefoneHash {
  if (!/^\d{10}$/.test(chaveDedup)) {
    throw new Error(
      `hashTelefone espera uma chaveDedup de 10 dígitos (DDD + 8), recebeu: ${JSON.stringify(chaveDedup)}. ` +
        'Passe o resultado de normalizarTelefone(), nunca o número cru da planilha.',
    );
  }
  return {
    hash: createHmac('sha256', segredo()).update(chaveDedup).digest('hex'),
    versao: HMAC_VERSAO_ATUAL,
  };
}

/** Comparação em tempo constante. Para conferências fora do banco. */
export function hashesIguais(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'utf8');
  const bb = Buffer.from(b, 'utf8');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}
