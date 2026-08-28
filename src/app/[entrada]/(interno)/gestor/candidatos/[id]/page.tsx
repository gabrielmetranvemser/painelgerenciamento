import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { rotas } from '@/lib/links-internos';
import { criarClienteServidor } from '@/lib/supabase/server';
import { Avatar, Pilula } from '@/components/ui';
import {
  ROTULO_CARGO,
  type Candidato, type Material, type Municipio, type PapelUsuario,
} from '@/lib/tipos-banco';
import { FormularioCandidato } from '../formulario';
import { Materiais } from './materiais';
import { AtendentesDoCandidato, type AtendenteDoCandidato } from './atendentes';
import { ComitesDoCandidato } from './comites';
import { carregarComites } from '@/lib/acoes-comites';

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

  const [{ data: candidato }, { data: materiais }, { data: vinculos }, { data: usuarios }] =
    await Promise.all([
      supabase.from('candidatos').select('*').eq('id', id).maybeSingle(),
      supabase.from('materiais').select('*').eq('candidato_id', id).order('ordem'),
      supabase.from('atendente_candidatos')
        .select('atendente_id, principal').eq('candidato_id', id),
      // Gestor entra na lista também: nesta operação ele atende — tem chip e
      // atalho para a tela de atendimento. Filtrar por papel deixaria a
      // candidatura sem ninguém justamente na campanha pequena, que é o caso.
      supabase.from('usuarios')
        .select('id, primeiro_nome, ativo, papel').order('primeiro_nome'),
    ]);

  if (!candidato) notFound();
  const c = candidato as Candidato;

  // Onde a pessoa pode buscar material. Depende do candidato existir, então vem
  // depois do `notFound`.
  const [comites, { data: municipios }] = await Promise.all([
    carregarComites(id),
    supabase.from('municipios').select('*').order('nome'),
  ]);

  const porAtendente = new Map(
    ((vinculos ?? []) as { atendente_id: string; principal: boolean }[])
      .map((v) => [v.atendente_id, v.principal]),
  );
  const equipe = (usuarios ?? []) as
    { id: string; primeiro_nome: string; ativo: boolean; papel: PapelUsuario }[];

  const atendentes: AtendenteDoCandidato[] = equipe
    .filter((u) => porAtendente.has(u.id))
    .map((u) => ({ ...u, principal: porAtendente.get(u.id) ?? false }));

  // Conta inativa não entra na lista de quem dá para acrescentar: atribuir
  // candidato a quem não trabalha só faz o gestor achar que tem cobertura.
  const disponiveis = equipe.filter((u) => u.ativo && !porAtendente.has(u.id));

  return (
    <>
      <Link href={rotas(entrada).gestorCandidatos}
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
        <div className="space-y-6">
          <AtendentesDoCandidato
            candidatoId={c.id} nomeUrna={c.nome_urna} atendentes={atendentes}
            disponiveis={disponiveis} entrada={entrada}
          />
          <Materiais candidatoId={c.id} materiais={(materiais ?? []) as Material[]}
                     previaHref={rotas(entrada).gestorCandidatoPrevia(c.id)} />
          <ComitesDoCandidato
            candidatoId={c.id} comites={comites}
            municipios={(municipios ?? []) as Municipio[]}
          />
        </div>
      </div>
    </>
  );
}
