import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { chegouPeloEnderecoAntigo } from '@/lib/dominios-candidatos';
import { metadadosDoCandidato, PaginaPublicaDoCandidato } from './pagina';

export const dynamic = 'force-dynamic';

/**
 * A página do candidato no endereço padrão: `/{slug}`.
 *
 * ⚠️ Depois que o candidato ganha domínio próprio conferido, este endereço
 * MORRE para ele: 404, igual a qualquer endereço inexistente.
 *
 * A versão anterior desviava para o domínio novo, o que preservava os links já
 * enviados. O gestor foi avisado do preço — mil e quarenta e um links em
 * conversas de duzentas e dez pessoas — e decidiu assim mesmo: nada da campanha
 * pode responder num endereço que não seja o dela. Quem clicar num link antigo
 * pede outro, e o atendente reenvia pela ficha do contato.
 *
 * Continua valendo para candidato SEM domínio: ali este é o único endereço que
 * existe. E apagar o domínio em Candidatos devolve tudo a funcionar aqui na
 * hora — é a saída se o domínio da campanha cair.
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

  if (await chegouPeloEnderecoAntigo({ slug: entrada })) notFound();

  return <PaginaPublicaDoCandidato slug={entrada} />;
}
