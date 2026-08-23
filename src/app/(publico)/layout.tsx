import type { Metadata } from 'next';

/**
 * Páginas que o eleitor abre: /kit, /site, /m/[token], /privacidade.
 *
 * Diferente do painel, elas acompanham a preferência do aparelho. Quem chega
 * aqui está no celular dele, quase sempre em modo claro — e página clara lê
 * como documento oficial, que é exatamente o que a gente quer que pareça.
 *
 * A classe `publico` redefine os tokens de cor (ver globals.css). Um layout
 * aninhado não consegue alterar o <html>, então o invólucro cobre a tela
 * inteira e pinta o próprio fundo.
 */
// Sobrescreve o template do painel: "Peça seu kit · Painel" não faz sentido
// para quem nunca vai ver o painel.
export const metadata: Metadata = { title: { template: '%s', default: 'Campanha' } };

export default function LayoutPublico({ children }: { children: React.ReactNode }) {
  return (
    <div className="publico surgir flex min-h-screen flex-col bg-fundo text-texto">
      {children}
    </div>
  );
}
