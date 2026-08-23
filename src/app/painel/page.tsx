import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import type { Chip, FilaStatus, Municipio } from '@/lib/tipos-banco';
import { Atendimento } from './atendimento';

export const metadata: Metadata = { title: 'Atender' };

export default async function PaginaPainel() {
  const usuario = await exigirAtendente();
  const supabase = await criarClienteServidor();

  const [{ data: chips }, { data: municipios }] = await Promise.all([
    supabase
      .from('chips')
      .select('*')
      .eq('atendente_id', usuario.id)
      .not('status', 'in', '("morto")')
      .order('papel')
      .order('rotulo'),
    supabase.from('municipios').select('*').order('nome'),
  ]);

  const lista = (chips ?? []) as Chip[];

  let filaInicial: FilaStatus | null = null;
  if (lista.length > 0) {
    const { data } = await supabase.rpc('fila_status', { p_chip_id: lista[0].id });
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
