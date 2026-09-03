import type { Metadata } from 'next';
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
  return <PaginaPublicaDoCandidato slug={entrada} />;
}
