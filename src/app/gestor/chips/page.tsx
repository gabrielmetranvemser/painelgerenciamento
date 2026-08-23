import type { Metadata } from 'next';
import { Titulo } from '@/components/ui';
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
      <Titulo sub="Teto e saúde são por número, não por pessoa — o WhatsApp olha o número.">Números</Titulo>
      <GerenciarChips
        chips={(chips ?? []) as SaudeChip[]}
        atendentes={(atendentes ?? []) as Usuario[]}
      />
    </>
  );
}
