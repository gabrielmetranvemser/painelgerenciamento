'use server';

import { criarClienteServidor } from '@/lib/supabase/server';

export type EstadoEntrega = 'pendente' | 'entregue' | 'cancelado';

/**
 * Marca um pedido de material impresso como entregue, cancelado ou de volta
 * para pendente.
 *
 * A trava de gestor é do banco (`marcar_entrega` checa `is_gestor()`). Aqui a
 * função só repassa: validar de novo no cliente não acrescentaria segurança e
 * acrescentaria um lugar a mais para as duas regras discordarem.
 */
export async function marcarEntrega(
  captacaoId: string,
  estado: EstadoEntrega,
  observacao?: string | null,
) {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('marcar_entrega', {
    p_captacao_id: captacaoId,
    p_estado: estado,
    p_obs: observacao?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; motivo?: string; estado?: EstadoEntrega };
}
