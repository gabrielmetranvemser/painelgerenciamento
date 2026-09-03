import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { candidatoPorDominio, hostDaVisita } from '@/lib/dominios-candidatos';
import {
  metadadosDoCandidato,
  PaginaPublicaDoCandidato,
} from './[entrada]/(candidato)/pagina';

export const dynamic = 'force-dynamic';

/**
 * A raiz depende de POR ONDE a visita chegou.
 *
 * No endereço da Vercel ela não existe: quem digita só o domínio recebe 404 —
 * sem redirecionar, sem mensagem, sem nada que diga o que roda aqui. É a mesma
 * resposta da chave errada do painel e de qualquer endereço inexistente.
 *
 * No domínio próprio de um candidato (`material.sofiaandrade.com.br`), a raiz é
 * a página dele. É este arquivo, e só ele, que faz o domínio próprio funcionar:
 * o roteador do Next não olha o `Host`, então quem traduz endereço em candidato
 * é a consulta abaixo.
 *
 * ⚠️ Deliberadamente FORA do middleware. Ali a tradução custaria uma ida ao
 * banco em toda requisição do sistema, inclusive nas do painel, que não têm
 * nada a ver com isso. Aqui ela custa uma consulta cacheada, e só na página que
 * precisa dela.
 */
export async function generateMetadata(): Promise<Metadata> {
  const candidato = await candidatoPorDominio(await hostDaVisita());
  if (!candidato) return { title: 'Página' };
  return metadadosDoCandidato(candidato.slug);
}

export default async function Raiz() {
  const candidato = await candidatoPorDominio(await hostDaVisita());
  if (!candidato) notFound();
  return <PaginaPublicaDoCandidato slug={candidato.slug} />;
}
