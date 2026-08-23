import type { MetadataRoute } from 'next';

/**
 * Nada é rastreável.
 *
 * As páginas dos candidatos são alcançadas por link direto, do site de cada um
 * — não precisam de busca. E o painel não pode aparecer em lugar nenhum.
 *
 * ⚠️ NÃO listar caminhos em `disallow`: um robots.txt que diz "não indexe
 * /xyz/painel" está anunciando que existe um /xyz/painel. Bloquear tudo com
 * uma linha só não entrega nada.
 *
 * Sem `sitemap` de propósito.
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', disallow: '/' }],
  };
}
