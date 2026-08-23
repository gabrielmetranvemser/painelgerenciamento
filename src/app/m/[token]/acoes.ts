'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';

/**
 * Descadastro pela própria pessoa, sem precisar falar com ninguém.
 *
 * É Server Action, portanto só responde a POST — pré-carregador de link não
 * consegue disparar por engano, que é exatamente o problema que o filtro de bot
 * do /r/[token] existe para resolver.
 */
export async function descadastrar(token: string): Promise<{ ok: boolean }> {
  const supabase = criarClienteAdmin();
  const { data, error } = await supabase.rpc('descadastrar_por_token', { p_token: token });
  if (error) return { ok: false };
  return (data as { ok: boolean }) ?? { ok: false };
}
