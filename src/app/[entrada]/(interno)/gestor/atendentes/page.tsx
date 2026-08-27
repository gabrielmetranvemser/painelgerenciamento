import type { Metadata } from 'next';
import { Titulo } from '@/components/ui';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Candidato, CargoEleitoral, Usuario } from '@/lib/tipos-banco';
import type { ItemChapa } from './chapa-do-atendente';
import type { ItemLista } from './listas-do-atendente';
import { GerenciarAtendentes } from './lista';

export const metadata: Metadata = { title: 'Atendentes' };
export const dynamic = 'force-dynamic';

export default async function PaginaAtendentes({ params }: { params: Promise<{ entrada: string }> }) {
  const { entrada } = await params;
  const supabase = await criarClienteServidor();
  const [{ data }, { data: candidatos }, { data: atribuicoes }, { data: listas }, { data: deListas }] =
    await Promise.all([
      supabase.from('usuarios').select('*').order('papel').order('primeiro_nome'),
      supabase.from('candidatos').select('*').order('cargo').order('nome_urna'),
      supabase
        .from('atendente_candidatos')
        .select('atendente_id, candidato_id, cargo, vaga, principal, candidatos(nome_urna, numero)'),
      supabase.from('listas').select('id, rotulo, origem, ativa').order('criado_em', { ascending: false }),
      supabase.from('atendente_listas').select('atendente_id, lista_id'),
    ]);

  type Bruta = {
    atendente_id: string; candidato_id: string; cargo: CargoEleitoral;
    vaga: number; principal: boolean;
    candidatos: { nome_urna: string; numero: string } | { nome_urna: string; numero: string }[] | null;
  };

  const chapas: Record<string, ItemChapa[]> = {};
  for (const a of ((atribuicoes ?? []) as unknown as Bruta[])) {
    // O PostgREST devolve o relacionamento como lista, mesmo sendo 1:1.
    const rel = Array.isArray(a.candidatos) ? a.candidatos[0] : a.candidatos;
    (chapas[a.atendente_id] ??= []).push({
      candidato_id: a.candidato_id, cargo: a.cargo, vaga: a.vaga,
      principal: a.principal,
      nome: rel?.nome_urna ?? '—', numero: rel?.numero ?? '',
    });
  }
  for (const lista of Object.values(chapas)) {
    lista.sort((x, y) => Number(y.principal) - Number(x.principal));
  }

  const listasPorAtendente: Record<string, string[]> = {};
  for (const a of deListas ?? []) {
    (listasPorAtendente[a.atendente_id] ??= []).push(a.lista_id);
  }

  return (
    <>
      <Titulo sub="Quem desativar perde o acesso na hora e some da fila. Os contatos que estavam com a pessoa voltam para a fila quando o prazo de 20 minutos vencer.">Atendentes</Titulo>
      <GerenciarAtendentes
        usuarios={(data ?? []) as Usuario[]}
        entrada={entrada}
        candidatos={(candidatos ?? []) as Candidato[]}
        chapas={chapas}
        listas={(listas ?? []) as ItemLista[]}
        listasPorAtendente={listasPorAtendente}
      />
    </>
  );
}
