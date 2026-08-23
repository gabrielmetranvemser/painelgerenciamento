'use server';

import { criarClienteServidor } from '@/lib/supabase/server';
import type { EtapaMsg } from '@/lib/tipos-banco';

export type Historico = {
  ok: true;
  interacoes: {
    etapa: EtapaMsg;
    /** Nome de urna, nas etapas que são de um candidato. */
    candidato: string | null;
    aberto_wa_em: string;
    texto_enviado: string | null;
    resultado: string | null;
  }[];
  /** Cada clique real, com a peça que a pessoa abriu e de quem ela é. */
  cliques: { peca: string; candidato: string | null; quando: string }[];
  pedido_kit: { endereco: string | null; itens: string[] | null; em: string } | null;
} | { ok: false; motivo: string };

export async function carregarHistorico(contatoId: string): Promise<Historico> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('historico_contato', { p_contato_id: contatoId });
  if (error) throw new Error(error.message);
  return data as Historico;
}

/**
 * Anota o pedido de kit feito durante a conversa.
 * Cai no mesmo relatório que a equipe de entrega já usa.
 */
export async function registrarPedidoKit(
  contatoId: string,
  endereco: string,
  itens: string[],
  municipioId: number | null,
): Promise<{ ok: boolean; motivo?: string }> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('registrar_pedido_kit', {
    p_contato_id: contatoId,
    p_endereco: endereco.trim() || null,
    p_itens: itens,
    p_municipio_id: municipioId,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; motivo?: string };
}
