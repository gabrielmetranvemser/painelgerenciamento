import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { Cartao } from '@/components/ui';
import { textoDoAceite } from '@/lib/consentimento';
import { ROTULO_CARGO, type CargoEleitoral, type Municipio } from '@/lib/tipos-banco';
import { FormularioCandidato } from './formulario';

export const dynamic = 'force-dynamic';

type CandidatoPublico = {
  id: string; slug: string; nome_urna: string; cargo: CargoEleitoral; numero: string;
  partido_sigla: string | null; coligacao: string | null; cnpj_campanha: string | null;
  responsavel_material: string | null; slogan: string | null; chamada: string | null;
  ativo: boolean;
};

async function buscar(slug: string) {
  const supabase = criarClienteAdmin();
  const { data } = await supabase
    .from('candidatos')
    .select(
      'id, slug, nome_urna, cargo, numero, partido_sigla, coligacao, cnpj_campanha, ' +
      'responsavel_material, slogan, chamada, ativo',
    )
    .eq('slug', slug)
    .maybeSingle();
  return (data as CandidatoPublico | null) ?? null;
}

/**
 * O título e a descrição saem do próprio candidato.
 *
 * Nada aqui pode citar painel, atendimento, lead ou campanha interna: quem abre
 * o código-fonte tem de ver uma página de pedir material e mais nada. É por
 * isso que o layout raiz tem metadado neutro — quando esta página esquecer de
 * sobrescrever alguma coisa, o que herda não denuncia nada.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ entrada: string }>;
}): Promise<Metadata> {
  const { entrada } = await params;
  const c = await buscar(entrada);
  if (!c?.ativo) return { title: 'Material da campanha' };
  return {
    title: `Material de ${c.nome_urna}`,
    description: `Peça o material da campanha de ${c.nome_urna} pelo WhatsApp.`,
    robots: { index: false, follow: false },
  };
}

export default async function PaginaDoCandidato({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const candidato = await buscar(entrada);

  // Endereço que não é de candidato ativo devolve 404 — a MESMA resposta que a
  // chave errada do painel e que qualquer endereço inexistente. De fora não dá
  // para separar as três.
  if (!candidato?.ativo) notFound();

  const supabase = criarClienteAdmin();
  const { data: municipios } = await supabase.from('municipios').select('*').order('nome');

  const aceite = textoDoAceite(candidato);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 px-4 py-10 sm:px-6">
      <header className="mb-6 text-center">
        <p className="text-sm text-suave">
          {ROTULO_CARGO[candidato.cargo]} · nº {candidato.numero}
          {candidato.partido_sigla && ` · ${candidato.partido_sigla}`}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
          {candidato.nome_urna}
        </h1>
        {candidato.slogan && <p className="mt-1 text-[15px] text-suave">{candidato.slogan}</p>}
        <p className="mt-4 text-[15px] leading-relaxed text-suave">
          {candidato.chamada ??
            'Deixe seu contato para receber o material da campanha pelo WhatsApp. ' +
            'Quem fala com você é uma pessoa da equipe — sem robô e sem lista de transmissão.'}
        </p>
      </header>

      <Cartao className="p-7" elevado>
        <FormularioCandidato
          slug={candidato.slug}
          aceite={aceite}
          municipios={(municipios ?? []) as Municipio[]}
        />
      </Cartao>

      <div className="mt-6 space-y-2 text-center">
        <p className="text-xs leading-relaxed text-suave">
          Propaganda eleitoral de {candidato.nome_urna}
          {candidato.partido_sigla && ` — ${candidato.partido_sigla}`}
          {candidato.coligacao && ` (${candidato.coligacao})`}
          {candidato.cnpj_campanha && ` · CNPJ ${candidato.cnpj_campanha}`}
          {candidato.responsavel_material && ` · Responsável: ${candidato.responsavel_material}`}
        </p>
        <p className="text-xs leading-relaxed text-suave">
          Seus dados são usados só para este contato de campanha e não são vendidos nem cedidos.{' '}
          <Link href="/privacidade" className="underline underline-offset-4">
            Como tratamos seus dados
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
