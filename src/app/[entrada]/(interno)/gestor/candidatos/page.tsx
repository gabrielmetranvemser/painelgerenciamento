import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { ChevronRight, UserPlus, Users } from 'lucide-react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { rotas } from '@/lib/links-internos';
import { Avatar, Cartao, Pilula, Titulo, Vazio } from '@/components/ui';
import { ROTULO_CARGO, type Candidato, type CargoEleitoral } from '@/lib/tipos-banco';
import { FormularioCandidato } from './formulario';

export const metadata: Metadata = { title: 'Candidatos' };
export const dynamic = 'force-dynamic';

const ORDEM: CargoEleitoral[] = [
  'deputado_federal', 'deputado_estadual', 'deputado_distrital',
  'senador', 'governador', 'presidente',
];

export default async function PaginaCandidatos({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const supabase = await criarClienteServidor();
  const cabecalhos = await headers();
  const origem = `https://${cabecalhos.get('host') ?? 'seu-dominio.com.br'}`;

  const [{ data: candidatos }, { data: chapas }, { data: materiais }] = await Promise.all([
    supabase.from('candidatos').select('*').order('cargo').order('nome_urna'),
    supabase.from('atendente_candidatos').select('candidato_id'),
    supabase.from('materiais').select('candidato_id').eq('ativo', true),
  ]);

  const lista = (candidatos ?? []) as Candidato[];
  const porCandidato = (linhas: { candidato_id: string }[] | null, id: string) =>
    (linhas ?? []).filter((l) => l.candidato_id === id).length;

  const ordenados = [...lista].sort(
    (a, b) => ORDEM.indexOf(a.cargo) - ORDEM.indexOf(b.cargo) || a.vaga - b.vaga,
  );

  return (
    <>
      <Titulo sub="Cada candidato tem endereço público próprio, materiais próprios e link rastreado por peça.">
        Candidatos
      </Titulo>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_420px]">
        <section>
          <h2 className="mb-3 text-[13px] font-semibold uppercase tracking-[0.08em] text-suave">
            Cadastrados
          </h2>
          {ordenados.length === 0 ? (
            <Vazio icone={<Users size={26} />}>
              Nenhum candidato cadastrado. Sem pelo menos um, a primeira mensagem sai sem nome
              e os atendentes não conseguem trabalhar.
            </Vazio>
          ) : (
            <Cartao className="divide-y divide-borda overflow-hidden">
              {ordenados.map((c) => {
                const atendentes = porCandidato(chapas, c.id);
                const pecas = porCandidato(materiais, c.id);
                return (
                  <Link
                    key={c.id}
                    href={rotas(entrada).gestorCandidato(c.id)}
                    className="flex flex-wrap items-center gap-3 px-5 py-4 transition-colors hover:bg-superficie-alta"
                  >
                    <Avatar nome={c.nome_urna} fotoUrl={c.foto_url} tamanho="m" />
                    <div className="mr-auto min-w-0">
                      <p className="truncate font-semibold">
                        {c.nome_urna}
                        <span className="ml-2 font-mono text-xs font-normal text-suave">{c.numero}</span>
                      </p>
                      <p className="truncate text-xs text-suave">
                        {ROTULO_CARGO[c.cargo]}
                        {c.cargo === 'senador' && ` · ${c.vaga}ª vaga`}
                        {c.partido_sigla && ` · ${c.partido_sigla}`}
                        {' · '}/{c.slug}
                      </p>
                    </div>
                    {!c.ativo && <Pilula cor="neutro">inativo</Pilula>}
                    {pecas === 0 && c.ativo && <Pilula cor="alerta">sem material</Pilula>}
                    {atendentes === 0 && c.ativo && <Pilula cor="perigo">sem atendente</Pilula>}
                    {atendentes > 0 && (
                      <span className="text-xs text-suave">{atendentes} atendente(s)</span>
                    )}
                    <ChevronRight size={16} className="text-tenue" />
                  </Link>
                );
              })}
            </Cartao>
          )}

          {ordenados.some((c) => c.ativo && porCandidato(chapas, c.id) === 0) && (
            <p className="mt-3 text-xs leading-relaxed text-suave">
              Candidato sem atendente não recebe ninguém: os leads que chegarem pela página dele
              ficam parados na fila, porque a fila só entrega o lead de um candidato a quem atende
              aquele candidato.
            </p>
          )}
        </section>

        <section>
          <h2 className="mb-3 flex items-center gap-2 text-[13px] font-semibold uppercase tracking-[0.08em] text-suave">
            <UserPlus size={14} /> Novo candidato
          </h2>
          <FormularioCandidato origem={origem} />
        </section>
      </div>
    </>
  );
}
