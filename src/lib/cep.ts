/**
 * CEP e endereço de entrega.
 *
 * Funções puras, sem rede: a consulta ao serviço de CEP mora em
 * `src/lib/busca-cep.ts`, que só roda no servidor.
 *
 * O endereço deixou de ser um campo de texto livre porque quem entrega o
 * material impresso lê a lista na rua. "Rua das Flores 123 fundos perto do
 * mercado" e "R. das Flores, casa azul" são a mesma casa e viravam duas linhas
 * do relatório — e nenhuma das duas tinha bairro para agrupar a rota.
 */

export type EnderecoEstruturado = {
  /** 8 dígitos, sem hífen. Null quando a pessoa não soube o CEP. */
  cep: string | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
};

export const ENDERECO_VAZIO: EnderecoEstruturado = {
  cep: null, rua: null, numero: null, bairro: null,
};

/** Tamanhos de camiseta. Fechado, senão o relatório recebe "M/G" e "media". */
export const TAMANHOS_CAMISETA = ['P', 'M', 'G', 'GG', 'XGG'] as const;
export type TamanhoCamiseta = (typeof TAMANHOS_CAMISETA)[number];

/**
 * Reduz o que a pessoa digitou a 8 dígitos. Devolve null se não chegar lá.
 *
 * Aceita "76801-000", "76801000" e "76.801-000" — as três formas que aparecem
 * quando alguém cola o endereço de outro lugar.
 */
export function normalizarCep(bruto: string | null | undefined): string | null {
  const digitos = String(bruto ?? '').replace(/\D/g, '');
  return digitos.length === 8 ? digitos : null;
}

/** "76801000" → "76801-000". Para mostrar. */
export function formatarCep(cep: string): string {
  const d = cep.replace(/\D/g, '');
  return d.length === 8 ? `${d.slice(0, 5)}-${d.slice(5)}` : cep;
}

/**
 * Máscara enquanto digita: "768010" → "76801-0".
 *
 * Corta em 8 dígitos de propósito — assim quem cola um endereço inteiro no
 * campo do CEP não fica com lixo invisível depois do que aparece na tela.
 */
export function mascaraCep(bruto: string): string {
  const d = bruto.replace(/\D/g, '').slice(0, 8);
  return d.length > 5 ? `${d.slice(0, 5)}-${d.slice(5)}` : d;
}

/**
 * Compara nome de cidade ignorando acento, hífen e caixa.
 *
 * Mesma regra do casamento de município da importação: o serviço de CEP
 * devolve "Espigão D'Oeste" e a nossa tabela guarda "Espigão d'Oeste".
 */
export function mesmaCidade(a: string | null, b: string | null): boolean {
  if (!a || !b) return false;
  // ̀-ͯ é o bloco de acentos combinantes, escrito escapado porque
  // acento solto no código-fonte some no primeiro editor que "arruma" o arquivo.
  const chave = (s: string) =>
    s.trim().toLowerCase().normalize('NFD')
      .replace(/[̀-ͯ]/g, '')
      .replace(/[^a-z0-9]+/g, '');
  return chave(a) === chave(b);
}

/** Tem o mínimo para a equipe de entrega achar a casa? */
export function enderecoUtilizavel(e: EnderecoEstruturado): boolean {
  return Boolean(e.rua?.trim() && e.bairro?.trim());
}

/**
 * A linha única que a equipe de entrega lê.
 *
 * Continua existindo porque o relatório, a exportação e a busca de entregas já
 * leem `captacoes.endereco`. As partes ficam nas colunas novas; esta linha é a
 * forma de ler tudo de uma vez — e é o que mantém os pedidos antigos, de quando
 * o campo era texto livre, na mesma lista dos novos.
 */
export function montarLinhaEndereco(e: EnderecoEstruturado): string {
  const rua = [limpar(e.rua), limpar(e.numero)].filter(Boolean).join(', ');
  const local = [rua, limpar(e.bairro)].filter(Boolean).join(' — ');
  const cep = e.cep ? `CEP ${formatarCep(e.cep)}` : null;
  return [local, cep].filter(Boolean).join(' · ');
}

function limpar(v: string | null | undefined): string {
  return (v ?? '').trim();
}
