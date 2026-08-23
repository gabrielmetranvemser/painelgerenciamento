import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import type { Chip, FilaStatus, Municipio } from '@/lib/tipos-banco';
import { Atendimento } from './atendimento';

export const metadata: Metadata = { title: 'Atender' };

export default async function PaginaPainel({ params }: { params: Promise<{ entrada: string }> }) {
  const { entrada } = await params;
  const usuario = await exigirAtendente(entrada);
  const supabase = await criarClienteServidor();

  const [{ data: chips }, { data: municipios }] = await Promise.all([
    // Traz os mortos também: o atendente precisa ser AVISADO de que o número
    // caiu, não descobrir sozinho que ele sumiu do seletor.
    supabase
      .from('chips')
      .select('*')
      .eq('atendente_id', usuario.id)
      .order('papel')
      .order('rotulo'),
    supabase.from('municipios').select('*').order('nome'),
  ]);

  const lista = (chips ?? []) as Chip[];
  const vivos = lista.filter((c) => c.status !== 'morto');

  let filaInicial: FilaStatus | null = null;
  if (vivos.length > 0) {
    const { data } = await supabase.rpc('fila_status', { p_chip_id: vivos[0].id });
    filaInicial = (data as FilaStatus) ?? null;
  }

  return (
    <Atendimento
      primeiroNome={usuario.primeiro_nome}
      chips={lista}
      municipios={(municipios ?? []) as Municipio[]}
      filaInicial={filaInicial}
    />
  );
}
