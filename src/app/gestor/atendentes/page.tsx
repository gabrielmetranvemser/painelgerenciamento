import type { Metadata } from 'next';
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
      <h1 className="mb-1 text-xl font-semibold">Atendentes</h1>
      <p className="mb-5 text-sm text-suave">
        Quem desativar perde o acesso na hora e some da fila. Os contatos que estavam com a
        pessoa voltam para a fila quando o prazo de 20 minutos vencer.
      </p>
      <GerenciarAtendentes usuarios={(data ?? []) as Usuario[]} />
    </>
  );
}
