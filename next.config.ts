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

const nextConfig: NextConfig = {
  // Um cabeçalho a menos anunciando o que roda aqui. Não esconde o framework —
  // os caminhos /_next/static continuam entregando isso — mas não custa nada.
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: '/:caminho*',
        headers: [
          {
            // Quem pode colocar o painel dentro de um iframe: nós mesmos e a
            // extensão do painel lateral. Sem isto, QUALQUER site podia
            // enquadrar o painel e capturar cliques do atendente por cima.
            key: 'Content-Security-Policy',
            value: `frame-ancestors 'self' chrome-extension://${EXTENSAO}`,
          },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          {
            // Nada nesta aplicação usa câmera, microfone ou localização.
            key: 'Permissions-Policy',
            value: 'camera=(), microphone=(), geolocation=(), interest-cohort=()',
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
