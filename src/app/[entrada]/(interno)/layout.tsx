import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ehChaveDoPainel } from '@/lib/rotas';

/**
 * Porta de entrada do painel.
 *
 * Tudo que é interno vive sob um primeiro segmento secreto. Se o segmento não
 * é a chave, a resposta é 404 — a MESMA resposta que qualquer endereço
 * inexistente recebe. Nada aqui pode indicar que existe um painel: nem um
 * redirecionamento para login, nem uma mensagem diferente, nem um código de
 * status distinto. Quem varre o domínio não deve conseguir separar
 * "endereço errado" de "endereço certo com chave errada".
 */
// A identidade só existe daqui para dentro, embaixo do segmento secreto.
export const metadata: Metadata = {
  title: { default: 'Painel', template: '%s · Painel' },
  robots: { index: false, follow: false, nocache: true },
};

export default async function PortaInterna({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  if (!ehChaveDoPainel(entrada)) notFound();
  return children;
}
