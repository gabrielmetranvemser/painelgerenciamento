import { describe, expect, it } from 'vitest';
import {
  DDDS_VALIDOS,
  formatarExibicao,
  normalizarTelefone,
  urlWhatsApp,
  type MotivoInvalido,
} from './telefone';

/** Atalho: normaliza e exige que tenha passado. */
function ok(bruto: string | number) {
  const r = normalizarTelefone(bruto);
  if (!r.valido) throw new Error(`esperava válido, veio inválido (${r.motivo}): ${bruto}`);
  return r;
}

/** Atalho: normaliza e exige que tenha sido rejeitado pelo motivo esperado. */
function rejeita(bruto: unknown, motivo: MotivoInvalido) {
  const r = normalizarTelefone(bruto as string);
  expect({ bruto, valido: r.valido, motivo: r.valido ? null : r.motivo }).toEqual({
    bruto,
    valido: false,
    motivo,
  });
}

describe('normalizarTelefone — formatos que chegam na planilha', () => {
  // O mesmo celular de Porto Velho escrito de todo jeito que aparece na vida real.
  // TODOS têm que colapsar na mesma chaveDedup, senão dois atendentes ligam
  // para a mesma pessoa.
  const MESMO_NUMERO = [
    '+55 69 9 8123-4567',
    '+55 (69) 98123-4567',
    '55 69 98123 4567',
    '5569981234567',
    '(69) 98123-4567',
    '69 98123-4567',
    '69981234567',
    '069981234567',        // zero de tronco
    '0 (69) 98123-4567',
    ' 69981234567 ',
    '69.98123.4567',
    '69/98123-4567',
    '69 98123 4567 (recado)',
    5569981234567,          // planilha exportou como número
    // as formas antigas, sem o nono dígito — a pegadinha do documento
    '+55 69 8123-4567',
    '(69) 8123-4567',
    '6981234567',
    '556981234567',
    '06981234567',
  ];

  it.each(MESMO_NUMERO)('%s → chaveDedup 6981234567', (entrada) => {
    expect(ok(entrada).chaveDedup).toBe('6981234567');
  });

  it('todas as formas produzem exatamente uma chave distinta', () => {
    const chaves = new Set(MESMO_NUMERO.map((e) => ok(e).chaveDedup));
    expect([...chaves]).toEqual(['6981234567']);
  });

  it('o e164 sai canônico e com o nono dígito, mesmo vindo sem ele', () => {
    expect(ok('6981234567').e164).toBe('5569981234567');
    expect(ok('69981234567').e164).toBe('5569981234567');
    expect(ok('+55 (69) 8123-4567').e164).toBe('5569981234567');
  });

  it('e164 é só dígitos — é o que a URL do WhatsApp espera', () => {
    expect(ok('+55 (69) 98123-4567').e164).toMatch(/^\d+$/);
  });
});

describe('normalizarTelefone — celulares de outros DDDs', () => {
  const CASOS: Array<[string, string, string]> = [
    // [entrada, e164 esperado, chaveDedup esperada]
    ['11987654321', '5511987654321', '1187654321'],
    ['(11) 98765-4321', '5511987654321', '1187654321'],
    ['1187654321', '5511987654321', '1187654321'], // forma antiga do mesmo
    ['21 96666-7777', '5521966667777', '2166667777'],
    ['+55 85 9 7777-8888', '5585977778888', '8577778888'],
    ['92988887777', '5592988887777', '9288887777'],
    ['+5548999998888', '5548999998888', '4899998888'],
    ['6899999999', '5568999999999', '6899999999'],
  ];

  it.each(CASOS)('%s → %s / %s', (entrada, e164, chave) => {
    const r = ok(entrada);
    expect([r.e164, r.chaveDedup]).toEqual([e164, chave]);
  });
});

describe('normalizarTelefone — DDD 55 não pode ser confundido com o DDI 55', () => {
  // Santa Maria/RS é DDD 55. "55999887766" tem 11 dígitos e é DDD 55 + celular,
  // NÃO é DDI 55 + um número de 9 dígitos.
  it('11 dígitos começando em 55 é DDD 55, não DDI', () => {
    const r = ok('55999887766');
    expect([r.ddd, r.e164, r.chaveDedup]).toEqual(['55', '5555999887766', '5599887766']);
  });

  it('13 dígitos começando em 5555 é DDI + DDD 55', () => {
    expect(ok('5555999887766').e164).toBe('5555999887766');
  });

  it('DDI 55 duplicado por merge de planilha é absorvido', () => {
    expect(ok('555569981234567').chaveDedup).toBe('6981234567');
  });

  it('as duas grafias do mesmo número de Santa Maria colapsam', () => {
    expect(ok('55999887766').chaveDedup).toBe(ok('5555999887766').chaveDedup);
  });
});

describe('normalizarTelefone — telefone FIXO é rejeitado', () => {
  // Esta é a correção mais importante sobre o pseudocódigo do documento, que
  // adicionava o nono dígito a qualquer número de 10 dígitos e criava celulares
  // inexistentes a partir de telefones fixos.
  it.each([
    '6932214567',       // Porto Velho, fixo
    '(69) 3221-4567',
    '+55 69 3221-4567',
    '556932214567',
    '1122334455',       // SP, fixo
    '2124685555',       // RJ, fixo
    '8534567890',       // CE, fixo
    '4832101234',       // SC, fixo
  ])('%s é fixo e não entra na fila', (entrada) => {
    rejeita(entrada, 'fixo');
  });

  it('NÃO transforma fixo em celular inventado', () => {
    const r = normalizarTelefone('6932214567');
    expect(r.e164).toBeNull();
    expect(r.valido).toBe(false);
  });
});

describe('normalizarTelefone — rejeições', () => {
  it.each([
    ['', 'vazio'],
    ['   ', 'vazio'],
    ['sem telefone', 'vazio'],
    ['-', 'vazio'],
    [null, 'vazio'],
    [undefined, 'vazio'],
  ] as Array<[unknown, MotivoInvalido]>)('%s → vazio', (entrada, motivo) => {
    rejeita(entrada, motivo);
  });

  it.each([
    '999999',
    '69 9812',
    '981234567',    // faltou o DDD
    '00991234567',  // só zeros de tronco + 9 dígitos: sobra um número sem DDD
  ])('%s é curto demais', (entrada) => {
    rejeita(entrada, 'curto');
  });

  it.each([
    '6091234567',    // 60 não existe
    '2391234567',    // 23 não existe
    '3091234567',    // 30 não existe
    '7891234567',    // 78 não existe
    '5550981234567', // DDI 55 + DDD 50, que não existe
  ])('%s tem DDD inexistente', (entrada) => {
    rejeita(entrada, 'ddd_invalido');
  });

  it('número estrangeiro não entra na fila', () => {
    // +1 415 555 2671 → 14155552671 (11 díg). O DDD "14" até existe (Bauru/SP),
    // mas o local "155552671" não começa com 9, então é rejeitado por formato.
    // O que importa: não vira contato.
    expect(normalizarTelefone('+1 415 555 2671').valido).toBe(false);
    expect(normalizarTelefone('+351 912 345 678').valido).toBe(false);
  });

  it('local de 9 dígitos que não começa com 9 é rejeitado', () => {
    rejeita('69812345678', 'formato');
  });

  it('local de 8 dígitos começando em 0 ou 1 é rejeitado', () => {
    rejeita('6901234567', 'formato');
    rejeita('6912345678', 'formato');
  });

  it('duas células coladas viram número longo demais', () => {
    rejeita('69981234567699812345', 'longo');
  });
});

describe('DDDS_VALIDOS', () => {
  it('tem exatamente os 67 DDDs em uso', () => {
    expect(DDDS_VALIDOS.size).toBe(67);
  });

  it('não contém DDDs que não existem', () => {
    for (const inexistente of ['10', '20', '23', '25', '26', '29', '30', '36', '39', '40', '50', '52', '56', '57', '58', '59', '60', '70', '72', '76', '78', '80', '90']) {
      expect(DDDS_VALIDOS.has(inexistente)).toBe(false);
    }
  });
});

describe('formatarExibicao', () => {
  it.each([
    ['5569981234567', '(69) 98123-4567'],
    ['5511987654321', '(11) 98765-4321'],
  ])('%s → %s', (e164, esperado) => {
    expect(formatarExibicao(e164)).toBe(esperado);
  });
});

describe('urlWhatsApp', () => {
  it('monta a URL do WhatsApp Web com o texto codificado', () => {
    const url = urlWhatsApp('5569981234567', 'Bom dia, João! Tudo bem?');
    expect(url).toBe(
      'https://web.whatsapp.com/send?phone=5569981234567&text=Bom%20dia%2C%20Jo%C3%A3o!%20Tudo%20bem%3F',
    );
  });

  it('aceita e164 com máscara sem quebrar', () => {
    expect(urlWhatsApp('+55 (69) 98123-4567', 'oi')).toContain('phone=5569981234567');
  });

  it('preserva quebras de linha do texto', () => {
    expect(urlWhatsApp('5569981234567', 'linha1\nlinha2')).toContain('linha1%0Alinha2');
  });
});
