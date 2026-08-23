import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { Avatar, Pilula } from '@/components/ui';
import { ROTULO_CARGO, type Candidato, type Material } from '@/lib/tipos-banco';
import { FormularioCandidato } from '../formulario';
import { Materiais } from './materiais';

export const metadata: Metadata = { title: 'Candidato' };
export const dynamic = 'force-dynamic';

export default async function PaginaCandidato({
  params,
}: {
  params: Promise<{ entrada: string; id: string }>;
}) {
  const { entrada, id } = await params;
  const supabase = await criarClienteServidor();
  const cabecalhos = await headers();
  const origem = `https://${cabecalhos.get('host') ?? 'seu-dominio.com.br'}`;

  const [{ data: candidato }, { data: materiais }] = await Promise.all([
    supabase.from('candidatos').select('*').eq('id', id).maybeSingle(),
    supabase.from('materiais').select('*').eq('candidato_id', id).order('ordem'),
  ]);

  if (!candidato) notFound();
  const c = candidato as Candidato;

  return (
    <>
      <Link href={`/${entrada}/gestor/candidatos`}
            className="mb-5 inline-flex items-center gap-1.5 text-sm text-suave transition-colors hover:text-texto">
        <ArrowLeft size={15} /> Candidatos
      </Link>

      <header className="mb-6 flex flex-wrap items-center gap-4">
        <Avatar nome={c.nome_urna} fotoUrl={c.foto_url} tamanho="g" />
        <div className="mr-auto min-w-0">
          <h1 className="font-display text-3xl font-semibold tracking-tight">{c.nome_urna}</h1>
          <p className="mt-1 text-sm text-suave">
            {ROTULO_CARGO[c.cargo]}
            {c.cargo === 'senador' && ` · ${c.vaga}ª vaga`}
            {' · nº '}{c.numero}
            {c.partido_sigla && ` · ${c.partido_sigla}`}
          </p>
        </div>
        {!c.ativo && <Pilula cor="neutro">inativo</Pilula>}
        <a href={`${origem}/${c.slug}`} target="_blank" rel="noopener"
           className="rounded-full border border-borda px-3.5 py-2 font-mono text-xs text-suave transition-colors hover:border-borda-forte hover:text-texto">
          /{c.slug} ↗
        </a>
      </header>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <FormularioCandidato candidato={c} origem={origem} />
        <Materiais candidatoId={c.id} materiais={(materiais ?? []) as Material[]} />
      </div>
    </>
  );
}
