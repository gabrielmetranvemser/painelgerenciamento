/**
 * O painel responde SÓ no endereço dele.
 *
 * ⚠️ Isto nasceu de um vazamento real, achado em teste. Com o domínio próprio
 * de um candidato apontando para cá, `material.sofiaandrade.com.br/{chave}/painel`
 * devolvia 307 para a tela de entrar — enquanto qualquer outro endereço devolvia
 * 404. Ou seja: o redirecionamento CONFIRMAVA que aquele caminho existe, no host
 * mais exposto que este sistema tem, que é divulgado em post e mandado no
 * WhatsApp de milhares de pessoas. É exatamente o que o segmento secreto existe
 * para evitar (CLAUDE.md §7: nem status, nem redirecionamento, nem texto podem
 * separar "endereço errado" de "endereço certo com chave errada").
 *
 * A conta é feita só com variável de ambiente, de propósito: roda em TODA
 * requisição interna, e uma ida ao banco aqui sairia caro por uma checagem que
 * nunca muda.
 *
 * Falha para o lado de DEIXAR ENTRAR quando não dá para saber qual é o endereço
 * do painel: `*.vercel.app` é sempre aceito, então nem uma variável mal
 * configurada tranca quem trabalha para fora.
 */
export function hostEhDoPainel(bruto: string | null | undefined): boolean {
  const host = bruto?.trim().toLowerCase().split(':')[0];
  if (!host) return true;

  // Desenvolvimento. `*.localhost` NÃO entra: é como se testa domínio próprio
  // nesta máquina, e aceitá-lo aqui esconderia o defeito justamente no teste.
  if (host === 'localhost' || host === '127.0.0.1' || host === '[::1]') return true;

  // Todo deploy da Vercel, produção e pré-visualização.
  if (host === 'vercel.app' || host.endsWith('.vercel.app')) return true;

  const declarado = hostDe(process.env.LINK_BASE_URL)
    ?? hostDe(process.env.VERCEL_PROJECT_PRODUCTION_URL)
    ?? hostDe(process.env.VERCEL_URL);

  return declarado === null || declarado === host;
}

/** Aceita com ou sem esquema — a Vercel injeta as dela sem. */
function hostDe(valor: string | undefined): string | null {
  const t = valor?.trim().toLowerCase();
  if (!t) return null;
  return t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').split('/')[0].split(':')[0] || null;
}
