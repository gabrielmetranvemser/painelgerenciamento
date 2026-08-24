import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import { rotas } from '@/lib/links-internos';
import type { Chip, FilaStatus, Municipio } from '@/lib/tipos-banco';
import { Atendimento } from './atendimento';

export const metadata: Metadata = { title: 'Atender' };

export default async function PaginaPainel({ params }: { params: Promise<{ entrada: string }> }) {
  const { entrada } = await params;
  const usuario = await exigirAtendente(entrada);
  const supabase = await criarClienteServidor();

  const [{ data: chips }, { data: municipios }, { count: aguardando }] = await Promise.all([
    // Traz os mortos também: o atendente precisa ser AVISADO de que o número
    // caiu, não descobrir sozinho que ele sumiu do seletor.
    supabase
      .from('chips')
      .select('*')
      .eq('atendente_id', usuario.id)
      .order('papel')
      .order('rotulo'),
    supabase.from('municipios').select('*').order('nome'),
    // Conversas abertas esperando resposta. Sem este número elas viram uma
    // lista que ninguém lembra de abrir — e é lá que a maior parte do trabalho
    // de um dia termina.
    supabase
      .from('contatos')
      .select('id', { count: 'exact', head: true })
      .eq('atendente_id', usuario.id)
      .eq('status', 'em_atendimento')
      .not('primeiro_contato_em', 'is', null),
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
      aguardandoInicial={aguardando ?? 0}
      rotaMeusContatos={rotas(entrada).meusContatos}
    />
  );
}
