import 'server-only';

/**
 * O painel vive sob um primeiro segmento secreto: /{chave}/painel, /{chave}/gestor.
 *
 * ⚠️ Isto é OBSCURIDADE, não segurança. Serve para o painel não aparecer em
 * varredura nem em busca. Quem receber o endereço ainda encontra a tela de
 * login — a segurança de verdade continua sendo a autenticação e o RLS.
 *
 * A chave NUNCA vai para o pacote JavaScript: os links internos são montados a
 * partir do segmento que já está na URL da página aberta (`params.entrada`),
 * então ela não existe em nenhum arquivo que um estranho consiga baixar. É por
 * isso que este módulo é `server-only` e que as telas recebem `entrada` por
 * parâmetro em vez de lerem uma variável NEXT_PUBLIC.
 */
export function chavePainel(): string {
  const chave = process.env.PAINEL_CHAVE;
  if (!chave || chave.length < 8) {
    throw new Error(
      'PAINEL_CHAVE ausente ou curta demais. Sem ela o painel não tem endereço.',
    );
  }
  return chave;
}

/** `true` quando o primeiro segmento da URL é a chave do painel. */
export function ehChaveDoPainel(entrada: string): boolean {
  const chave = process.env.PAINEL_CHAVE;
  return Boolean(chave) && entrada === chave;
}
