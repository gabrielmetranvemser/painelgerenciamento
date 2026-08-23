import type { Metadata } from 'next';
import { Titulo } from '@/components/ui';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Usuario } from '@/lib/tipos-banco';
import { GerenciarAtendentes } from './lista';

export const metadata: Metadata = { title: 'Atendentes' };
export const dynamic = 'force-dynamic';

export default async function PaginaAtendentes() {
  const supabase = await criarClienteServidor();
  const { data } = await supabase.from('usuarios').select('*').order('papel').order('primeiro_nome');

  return (
    <>
      <Titulo sub="Quem desativar perde o acesso na hora e some da fila. Os contatos que estavam com a pessoa voltam para a fila quando o prazo de 20 minutos vencer.">Atendentes</Titulo>
      <GerenciarAtendentes usuarios={(data ?? []) as Usuario[]} />
    </>
  );
}
