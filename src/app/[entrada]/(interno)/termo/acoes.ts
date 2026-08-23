'use server';

import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * Grava o aceite com data e hora. Sem aceite, `fila_status` recusa entregar
 * contato — a trava está no servidor, não só nesta tela.
 */
export async function aceitarTermo(entrada: string): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${entrada}/entrar`);

  const { data: cfg } = await supabase.from('config').select('termo_versao').eq('id', 1).single();

  const { error } = await supabase
    .from('usuarios')
    .update({ termo_aceito_em: new Date().toISOString(), termo_versao: cfg?.termo_versao ?? 1 })
    .eq('id', user.id);

  if (error) return 'Não consegui gravar o aceite. Tente de novo.';
  redirect(`/${entrada}/painel`);
}
