import type { Metadata } from 'next';
import { Titulo } from '@/components/ui';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Config, DiaBloqueado } from '@/lib/tipos-banco';
import { FormularioConfig } from './formulario';

export const metadata: Metadata = { title: 'Configuração' };
export const dynamic = 'force-dynamic';

export default async function PaginaConfig({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const supabase = await criarClienteServidor();
  const [{ data: config }, { data: dias }] = await Promise.all([
    supabase.from('config').select('*').eq('id', 1).single(),
    supabase.from('dias_bloqueados').select('*').order('data'),
  ]);

  return (
    <>
      <Titulo sub="Vale para todo mundo. Mudanças passam a valer na próxima vez que o atendente pedir um contato.">Configuração</Titulo>
      <FormularioConfig config={config as Config} dias={(dias ?? []) as DiaBloqueado[]}
                        entrada={entrada} />
    </>
  );
}
