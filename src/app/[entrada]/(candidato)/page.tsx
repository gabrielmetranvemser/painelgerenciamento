import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { desvioParaODominio } from '@/lib/dominios-candidatos';
import { metadadosDoCandidato, PaginaPublicaDoCandidato } from './pagina';

export const dynamic = 'force-dynamic';

/**
 * A página do candidato no endereço padrão: `/{slug}`.
 *
 * ⚠️ Este endereço NUNCA sai do ar, mesmo depois de o candidato ganhar domínio
 * próprio. Todo link já enviado por WhatsApp aponta para cá e está no aparelho
 * de outra pessoa — desligar isto quebraria conversas antigas e, com elas, a
 * contagem de cliques que é a prova de que aquela pessoa abriu o material.
 *
 * O que ele faz, quando existe domínio conferido, é DESVIAR para lá. O
 * resultado é o que o gestor pediu — só o endereço da campanha aparece — sem o
 * preço de matar mil links que já estão em conversas abertas.
 *
 * O conteúdo vive em `pagina.tsx`, compartilhado com a raiz do domínio próprio.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ entrada: string }>;
}): Promise<Metadata> {
  const { entrada } = await params;
  return metadadosDoCandidato(entrada);
}

export default async function PaginaDoCandidato({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;

  const desvio = await desvioParaODominio({ slug: entrada }, '/');
  if (desvio) redirect(desvio);

  return <PaginaPublicaDoCandidato slug={entrada} />;
}
