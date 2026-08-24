import type { NextConfig } from 'next';

/**
 * ID da extensão do painel lateral.
 *
 * Derivado da chave pública fixada em extensao/manifest.json, então é o mesmo
 * na instalação manual e na Chrome Web Store. Se a chave da extensão mudar, o
 * ID muda e o painel para de abrir na lateral — defina EXTENSAO_ID no ambiente
 * para apontar para o novo.
 */
const EXTENSAO = process.env.EXTENSAO_ID ?? 'pdpffmibfeikfffdbpfklhdkifmceden';

/**
 * A política de conteúdo.
 *
 * Antes daqui saía uma linha só, `frame-ancestors`. Ela resolvia o problema
 * mais óbvio — outro site enquadrar o painel e capturar os cliques do atendente
 * por cima —, e nada além disso.
 *
 * ⚠️ Honestidade sobre o alcance: `script-src` precisa de `'unsafe-inline'`
 * porque o Next injeta scripts inline sem nonce, e nonce exigiria tornar toda
 * página dinâmica. Ou seja, isto NÃO é proteção contra XSS. O que ele entrega,
 * e que antes não existia:
 *
 *   connect-src   o painel só fala com a própria origem e com o Supabase. Se um
 *                 script hostil entrar de algum jeito, ele não consegue mandar a
 *                 base de contatos para fora — que é o dano que importa aqui.
 *   form-action   nenhum formulário desta aplicação posta para outro domínio.
 *                 Fecha a captura de e-mail e senha por formulário sequestrado.
 *   base-uri      impede reescrever a base das URLs relativas e sequestrar todo
 *                 caminho da página de uma vez.
 *   object-src    não existe Flash, PDF embutido nem applet aqui.
 *
 * As fontes são self-hosted pelo `next/font` (vão para /_next/static/media), por
 * isso `font-src 'self'` basta e nenhum host do Google aparece nesta lista.
 */
function politicaDeConteudo(): string {
  const supabase = process.env.NEXT_PUBLIC_SUPABASE_URL ?? '';
  const dev = process.env.NODE_ENV !== 'production';

  return [
    "default-src 'self'",
    // `unsafe-eval` só em desenvolvimento: é o React Refresh. Em produção não
    // entra — se um dia entrar, foi engano.
    `script-src 'self' 'unsafe-inline'${dev ? " 'unsafe-eval'" : ''}`,
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self'",
    // A foto e o fundo do candidato ficam no armazenamento do Supabase, mas
    // cadastros antigos podem apontar para qualquer host. Imagem de fora não
    // executa nada; recusar aqui só quebraria a página de quem entrega o lead.
    "img-src 'self' data: blob: https:",
    `connect-src 'self'${supabase ? ` ${supabase} ${supabase.replace('https://', 'wss://')}` : ''}`,
    "base-uri 'self'",
    "form-action 'self'",
    "object-src 'none'",
    // Quem pode enquadrar o painel: nós mesmos e a extensão do painel lateral.
    `frame-ancestors 'self' chrome-extension://${EXTENSAO}`,
  ].join('; ');
}

const nextConfig: NextConfig = {
  // Um cabeçalho a menos anunciando o que roda aqui. Não esconde o framework —
  // os caminhos /_next/static continuam entregando isso — mas não custa nada.
  poweredByHeader: false,

  // A rota que monta o pacote lê a pasta `extensao/` em tempo de execução, e o
  // rastreador do Next não tem como adivinhar isso sozinho: ele segue `import`,
  // e aqui a leitura é por caminho. Sem esta linha a pasta não é empacotada com
  // a função e o download quebra em produção — exatamente onde não dá para ver.
  outputFileTracingIncludes: {
    '/[entrada]/extensao': ['./extensao/**/*'],
  },

  async headers() {
    return [
      {
        source: '/:caminho*',
        headers: [
          { key: 'Content-Security-Policy', value: politicaDeConteudo() },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            // Nada nesta aplicação usa câmera, microfone ou localização.
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
          },
          {
            // Dois anos, subdomínios juntos. O painel só existe em https, e o
            // cookie de sessão é `Secure` — mas sem isto a PRIMEIRA visita do
            // dia, digitada sem "https://", sai em texto claro antes do desvio.
            // É a janela onde um Wi-Fi de lanchonete rouba a sessão inteira.
            key: 'Strict-Transport-Security',
            value: 'max-age=63072000; includeSubDomains',
          },
        ],
      },
      {
        // As páginas do link levam o token na URL. O token não contém dado
        // pessoal, mas quem o tem consegue descadastrar aquela pessoa — então
        // ele não pode vazar no Referer para o destino externo.
        source: '/:rota(r|m)/:token*',
        headers: [{ key: 'Referrer-Policy', value: 'no-referrer' }],
      },
    ];
  },
};

export default nextConfig;
