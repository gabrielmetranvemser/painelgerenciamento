'use server';

import { criarClienteServidor } from '@/lib/supabase/server';
import { montarLinhaEndereco, normalizarCep, type EnderecoEstruturado } from '@/lib/cep';
import type { EtapaMsg } from '@/lib/tipos-banco';

export type PedidoKit = {
  /** A linha montada, para quem só quer ler o endereço de uma vez. */
  endereco: string | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  tamanho_camiseta: string | null;
  itens: string[] | null;
  em: string;
};

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
  pedido_kit: PedidoKit | null;
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
 *
 * A linha de `endereco` é montada AQUI, no servidor, e não no navegador: é ela
 * que a exportação e a busca da tela de entregas leem, e o formato dela não
 * pode depender de qual tela gravou o pedido.
 */
export async function registrarPedidoKit(
  contatoId: string,
  endereco: EnderecoEstruturado,
  itens: string[],
  municipioId: number | null,
  tamanhoCamiseta: string | null,
): Promise<{ ok: boolean; motivo?: string }> {
  const supabase = await criarClienteServidor();
  const linha = montarLinhaEndereco(endereco);

  const { data, error } = await supabase.rpc('registrar_pedido_kit', {
    p_contato_id: contatoId,
    p_itens: itens,
    p_endereco: linha || null,
    p_cep: normalizarCep(endereco.cep),
    p_rua: endereco.rua?.trim() || null,
    p_numero: endereco.numero?.trim() || null,
    p_bairro: endereco.bairro?.trim() || null,
    // Tamanho só faz sentido com camiseta no pedido. Sem isto o relatório
    // recebe "M" num pedido que só tem adesivo.
    p_tamanho: itens.includes('camiseta') ? tamanhoCamiseta : null,
    p_municipio_id: municipioId,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; motivo?: string };
}
