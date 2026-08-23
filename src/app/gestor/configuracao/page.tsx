import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Config, DiaBloqueado, Destino } from '@/lib/tipos-banco';
import { FormularioConfig } from './formulario';

export const metadata: Metadata = { title: 'Configuração' };
export const dynamic = 'force-dynamic';

export default async function PaginaConfig() {
  const supabase = await criarClienteServidor();
  const [{ data: config }, { data: dias }, { data: destinos }] = await Promise.all([
    supabase.from('config').select('*').eq('id', 1).single(),
    supabase.from('dias_bloqueados').select('*').order('data'),
    supabase.from('destinos').select('*').order('chave'),
  ]);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Configuração</h1>
      <p className="mb-5 text-sm text-suave">
        Vale para todo mundo. Mudanças passam a valer na próxima vez que o atendente pedir um contato.
      </p>
      <FormularioConfig
        config={config as Config}
        dias={(dias ?? []) as DiaBloqueado[]}
        destinos={(destinos ?? []) as Destino[]}
      />
    </>
  );
}
