import type { Metadata } from 'next';
import { Titulo } from '@/components/ui';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Usuario } from '@/lib/tipos-banco';
import { Importador } from './importador';

export const metadata: Metadata = { title: 'Importar lista' };
export const dynamic = 'force-dynamic';

export default async function PaginaImportar() {
  // Os atendentes vêm daqui para o último passo da importação: escolher quem
  // atende a lista recém-criada. Sem esse passo a planilha entra na base e não
  // vai para fila nenhuma — e o gestor só descobre quando alguém reclama que
  // não tem contato.
  const supabase = await criarClienteServidor();
  const { data: atendentes } = await supabase
    .from('usuarios')
    .select('id, primeiro_nome')
    .eq('papel', 'atendente')
    .eq('ativo', true)
    .order('primeiro_nome');

  return (
    <>
      <Titulo sub="O sistema limpa a planilha e mostra o resultado antes de gravar qualquer coisa.">Importar lista</Titulo>
      <Importador atendentes={(atendentes ?? []) as Pick<Usuario, 'id' | 'primeiro_nome'>[]} />
    </>
  );
}
