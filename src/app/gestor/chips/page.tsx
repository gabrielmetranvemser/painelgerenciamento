import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { SaudeChip, Usuario } from '@/lib/tipos-banco';
import { GerenciarChips } from './lista';

export const metadata: Metadata = { title: 'Números' };
export const dynamic = 'force-dynamic';

export default async function PaginaChips() {
  const supabase = await criarClienteServidor();
  const [{ data: chips }, { data: atendentes }] = await Promise.all([
    supabase.from('v_saude_chip').select('*').order('rotulo'),
    supabase.from('usuarios').select('*').eq('ativo', true).order('primeiro_nome'),
  ]);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Números</h1>
      <p className="mb-5 text-sm text-suave">
        Teto e saúde são por número, não por pessoa — o WhatsApp olha o número.
      </p>
      <GerenciarChips
        chips={(chips ?? []) as SaudeChip[]}
        atendentes={(atendentes ?? []) as Usuario[]}
      />
    </>
  );
}
