import type { Metadata } from 'next';

/**
 * A página pública de um candidato: /{slug}.
 *
 * Mora sob o MESMO segmento dinâmico do painel — em Next não existe outro jeito,
 * dois nomes de parâmetro no mesmo nível é erro de build. Quem manda é o
 * conteúdo: se o segmento é a chave, responde o painel; se é o endereço de um
 * candidato, responde esta página; se não é nem um nem outro, 404. As três
 * respostas são indistinguíveis de fora.
 *
 * O metadado é neutro de propósito. Este layout não pode dizer "Painel" em
 * lugar nenhum: a página é feita para ser vista por qualquer pessoa e o
 * código-fonte dela precisa falar só de pedir material.
 */
export const metadata: Metadata = { title: { template: '%s', default: 'Material da campanha' } };

export default function LayoutCandidato({ children }: { children: React.ReactNode }) {
  return (
    <div className="publico surgir flex min-h-screen flex-col bg-fundo text-texto">
      {children}
    </div>
  );
}
