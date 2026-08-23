import type { Metadata } from 'next';
import { Bricolage_Grotesque, Manrope } from 'next/font/google';
import './globals.css';

/**
 * Bricolage Grotesque nos títulos e nos números grandes: tem largura e
 * grade ópticas variáveis, então cresce com caráter em vez de só esticar.
 * Manrope no resto — semi-geométrica, ótima em corpo pequeno e com numerais
 * tabulares limpos, que é o que uma tela cheia de contador precisa.
 */
const display = Bricolage_Grotesque({
  variable: '--fonte-display',
  subsets: ['latin'],
  display: 'swap',
});

const ui = Manrope({
  variable: '--fonte-ui',
  subsets: ['latin'],
  display: 'swap',
});

export const metadata: Metadata = {
  title: { default: 'Painel', template: '%s · Painel' },
  description: 'Painel interno de atendimento.',
  // O painel não pode ser indexado. As páginas públicas sobrescrevem.
  robots: { index: false, follow: false, nocache: true },
};

export default function RootLayout({ children }: LayoutProps<'/'>) {
  return (
    <html lang="pt-BR" className={`${display.variable} ${ui.variable} h-full`}>
      <body className="min-h-full flex flex-col antialiased">{children}</body>
    </html>
  );
}
