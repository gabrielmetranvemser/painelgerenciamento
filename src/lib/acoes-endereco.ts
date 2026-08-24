'use server';

import { buscarPorRua, consultarCep, type ResultadoBuscaRua, type ResultadoCep } from './busca-cep';

/**
 * As duas ações que o campo de endereço chama.
 *
 * Ficam em `lib/` e não ao lado de uma rota porque as DUAS telas de pedido de
 * material usam o mesmo componente: a página pública do candidato e o perfil do
 * contato no painel do atendente. Duplicar a ação seria duplicar o tempo-limite,
 * o cache e o tratamento de erro — e um dos dois ficaria para trás.
 *
 * São endpoints públicos, como toda Server Action. Está certo: é consulta de
 * CEP, o mesmo que qualquer site de entrega expõe, e nada aqui toca o banco nem
 * lê sessão. O que protege de virar proxy de graça é o cache de 30 dias em
 * `busca-cep.ts`.
 */

export async function acharPorCep(cep: string): Promise<ResultadoCep> {
  return consultarCep(cep);
}

export async function acharPorRua(
  uf: string, cidade: string, rua: string,
): Promise<ResultadoBuscaRua> {
  return buscarPorRua(uf, cidade, rua);
}
