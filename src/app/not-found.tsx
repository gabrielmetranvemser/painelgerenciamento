import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Página não encontrada',
  robots: { index: false, follow: false },
};

/**
 * 404 deliberadamente sem identidade.
 *
 * Nada de logotipo, nada de nome de campanha, nenhum link. É a resposta tanto
 * para um endereço inexistente quanto para uma tentativa de achar o painel, e
 * as duas precisam ser indistinguíveis.
 */
export default function NaoEncontrada() {
  // Sem <html> aqui: no App Router o not-found renderiza DENTRO do layout raiz,
  // e um segundo <html> produziria documento inválido.
  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        color: '#71717a',
        font: '15px system-ui, -apple-system, sans-serif',
      }}
    >
      <p>Página não encontrada.</p>
    </main>
  );
}
