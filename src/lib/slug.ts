import 'server-only';
import { chavePainel } from '@/lib/rotas';

/**
 * Endereços que um candidato NÃO pode ocupar.
 *
 * Candidato e painel dividem o mesmo primeiro segmento da URL. Um candidato com
 * slug igual à chave do painel derrubaria o painel inteiro — e um slug igual a
 * uma rota pública sequestraria essa rota.
 */
const RESERVADOS = new Set([
  'r', 'm', 'kit', 'site', 'privacidade', 'api', 'robots.txt', 'sitemap.xml',
  'favicon.ico', '_next', 'painel', 'gestor', 'entrar', 'termo', 'instalar',
  'admin', 'login', 'dashboard', 'app', 'static', 'public', 'assets',
]);

export type ProblemaSlug = 'formato' | 'reservado' | 'colide_com_painel';

export function validarSlug(slug: string): ProblemaSlug | null {
  const s = slug.trim().toLowerCase();

  // Mesma regra do CHECK em candidatos.slug: minúsculas, números e hífen,
  // começando e terminando por letra ou número.
  if (!/^[a-z0-9][a-z0-9-]{1,38}[a-z0-9]$/.test(s)) return 'formato';
  if (RESERVADOS.has(s)) return 'reservado';

  // O confronto que mais dói: derrubaria o acesso de todo mundo ao painel.
  try {
    if (s === chavePainel()) return 'colide_com_painel';
  } catch {
    // Sem chave configurada não há colisão possível.
  }
  return null;
}

export const TEXTO_PROBLEMA_SLUG: Record<ProblemaSlug, string> = {
  formato:
    'O endereço aceita só letras minúsculas, números e hífen, com 3 a 40 caracteres, ' +
    'começando e terminando em letra ou número. Ex.: maria-souza.',
  reservado: 'Esse endereço é usado pelo sistema. Escolha outro.',
  colide_com_painel:
    'Esse endereço derrubaria o acesso da equipe ao painel. Escolha outro.',
};

/** Sugere um endereço a partir do nome de urna. */
export function sugerirSlug(nomeUrna: string): string {
  return nomeUrna
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');
}
