import { describe, expect, it } from 'vitest';
import {
  analisarLinhas, casarMunicipio, decodificarPlanilha, emBlocos, sugerirMapa,
} from './importacao';

const MAPA = { nome: 'Nome', telefone: 'Telefone', municipio: 'Cidade' };

describe('sugerirMapa — planilhas chegam com cabeçalhos diferentes', () => {
  it.each([
    [['Nome', 'Telefone', 'Cidade'], 'Telefone'],
    [['NOME COMPLETO', 'CELULAR', 'MUNICÍPIO'], 'CELULAR'],
    [['nome', 'whatsapp', 'cidade'], 'whatsapp'],
    [['Eleitor', 'Fone', 'Localidade'], 'Fone'],
    [['nome', 'Número de contato'], 'Número de contato'],
  ])('%s → telefone: %s', (colunas, esperado) => {
    expect(sugerirMapa(colunas).telefone).toBe(esperado);
  });

  it('sem coluna de telefone, não há palpite a dar', () => {
    expect(sugerirMapa(['a', 'b'])).toEqual({ telefone: null });
  });

  it('acha o telefone mas não inventa nome e cidade', () => {
    expect(sugerirMapa(['Telefone'])).toEqual({ telefone: 'Telefone', nome: null, municipio: null });
  });
});

describe('analisarLinhas', () => {
  it('conta como o gestor vê na tela de conferência', () => {
    const r = analisarLinhas(
      [
        { Nome: 'MARIA SOUZA', Telefone: '(69) 99999-0001', Cidade: 'Porto Velho' },
        { Nome: 'joão alves', Telefone: '69999990002', Cidade: 'Ji-Paraná' },
        { Nome: 'Repetido', Telefone: '(69) 9999-0001', Cidade: '' },   // mesmo da 1ª, sem o 9
        { Nome: 'Fixo', Telefone: '(69) 3221-4567', Cidade: '' },       // telefone fixo
        { Nome: 'Vazio', Telefone: '', Cidade: '' },
        { Nome: 'DDD ruim', Telefone: '6091234567', Cidade: '' },
      ],
      MAPA,
    );

    expect({
      total: r.totalLinhas,
      validas: r.validas.length,
      duplicadas: r.duplicadasNoArquivo,
      invalidas: r.invalidas,
    }).toEqual({ total: 6, validas: 2, duplicadas: 1, invalidas: 3 });

    expect(r.porMotivo).toEqual({ fixo: 1, vazio: 1, ddd_invalido: 1 });
  });

  it('a linha repetida em OUTRO formato é pega', () => {
    const r = analisarLinhas(
      [
        { Nome: 'A', Telefone: '+55 69 98123-4567', Cidade: '' },
        { Nome: 'B', Telefone: '6981234567', Cidade: '' },
        { Nome: 'C', Telefone: '069981234567', Cidade: '' },
      ],
      MAPA,
    );
    // Se isto falhar, três atendentes ligam para a mesma pessoa.
    expect(r.validas).toHaveLength(1);
    expect(r.duplicadasNoArquivo).toBe(2);
  });

  it('normaliza o nome para uso na mensagem', () => {
    const r = analisarLinhas([{ Nome: 'JOSE DA SILVA', Telefone: '69999990001', Cidade: '' }], MAPA);
    expect(r.validas[0]).toMatchObject({
      nome: 'JOSE DA SILVA',
      primeiroNome: 'Jose',
      e164: '5569999990001',
      chaveDedup: '6999990001',
    });
  });

  it('funciona sem coluna de nome e sem coluna de cidade', () => {
    const r = analisarLinhas([{ Telefone: '69999990001' }], { nome: null, telefone: 'Telefone', municipio: null });
    expect(r.validas[0]).toMatchObject({ nome: null, primeiroNome: null, municipioNome: null });
  });

  it('guarda exemplos das rejeições, com a linha da planilha', () => {
    const r = analisarLinhas(
      [
        { Nome: 'ok', Telefone: '69999990001', Cidade: '' },
        { Nome: 'fixo', Telefone: '6932214567', Cidade: '' },
      ],
      MAPA,
    );
    // linha 3 da planilha = índice 1 + cabeçalho + base 1
    expect(r.exemplosRejeitados).toEqual([{ linha: 3, valor: '6932214567', motivo: 'fixo' }]);
  });

  it('arquivo vazio não quebra', () => {
    const r = analisarLinhas([], MAPA);
    expect(r).toMatchObject({ totalLinhas: 0, validas: [], invalidas: 0, duplicadasNoArquivo: 0 });
  });
});

describe('casarMunicipio', () => {
  const MUNICIPIOS = [
    { id: 37, nome: 'Porto Velho' },
    { id: 24, nome: 'Ji-Paraná' },
    { id: 19, nome: "Espigão d'Oeste" },
  ];

  it.each([
    ['Porto Velho', 37],
    ['porto velho', 37],
    ['PORTO VELHO', 37],
    ['  Porto Velho  ', 37],
    ['Ji-Parana', 24],       // sem acento
    ['JI-PARANÁ', 24],
    ["espigao d'oeste", 19],  // sem acento
    ['ESPIGAO D OESTE', 19],   // apóstrofo virou espaço, como o Excel exporta
    ["Espigao D'Oeste", 19],
    ['espigao  d  oeste', 19], // espaços repetidos
    ['ESPIGÃO DOESTE', 19],
    ['ji parana', 24],         // hífen virou espaço
  ])('%s → %s', (bruto, id) => {
    expect(casarMunicipio(bruto, MUNICIPIOS)).toBe(id);
  });

  it.each([null, undefined, '', '   ', 'Cidade Que Não Existe', 'Manaus'])(
    '%s não casa com nada',
    (bruto) => {
      expect(casarMunicipio(bruto, MUNICIPIOS)).toBeNull();
    },
  );

  // Colapsar pontuação só é seguro se nenhum par de municípios colidir. Se este
  // teste falhar, duas cidades diferentes estão sendo somadas no mesmo relatório.
  it('os 52 municípios de Rondônia produzem chaves distintas', () => {
    const RO = [
  'Alta Floresta d\'Oeste',
  'Alto Alegre dos Parecis',
  'Alto Paraíso',
  'Alvorada d\'Oeste',
  'Ariquemes',
  'Buritis',
  'Cabixi',
  'Cacaulândia',
  'Cacoal',
  'Campo Novo de Rondônia',
  'Candeias do Jamari',
  'Castanheiras',
  'Cerejeiras',
  'Chupinguaia',
  'Colorado do Oeste',
  'Corumbiara',
  'Costa Marques',
  'Cujubim',
  'Espigão d\'Oeste',
  'Governador Jorge Teixeira',
  'Guajará-Mirim',
  'Itapuã do Oeste',
  'Jaru',
  'Ji-Paraná',
  'Machadinho d\'Oeste',
  'Ministro Andreazza',
  'Mirante da Serra',
  'Monte Negro',
  'Nova Brasilândia d\'Oeste',
  'Nova Mamoré',
  'Nova União',
  'Novo Horizonte do Oeste',
  'Ouro Preto do Oeste',
  'Parecis',
  'Pimenta Bueno',
  'Pimenteiras do Oeste',
  'Porto Velho',
  'Presidente Médici',
  'Primavera de Rondônia',
  'Rio Crespo',
  'Rolim de Moura',
  'Santa Luzia d\'Oeste',
  'São Felipe d\'Oeste',
  'São Francisco do Guaporé',
  'São Miguel do Guaporé',
  'Seringueiras',
  'Teixeirópolis',
  'Theobroma',
  'Urupá',
  'Vale do Anari',
  'Vale do Paraíso',
  'Vilhena',
    ];
    const todos = RO.map((nome, i) => ({ id: i + 1, nome }));
    for (const m of todos) {
      expect(casarMunicipio(m.nome, todos)).toBe(m.id);
    }
    expect(RO).toHaveLength(52);
  });
});

describe('emBlocos', () => {
  it('divide para não estourar o tempo da função', () => {
    expect(emBlocos([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(emBlocos([], 500)).toEqual([]);
    expect(emBlocos([1], 500)).toEqual([[1]]);
  });
});

/**
 * A leitura do arquivo.
 *
 * As duas armadilhas cobertas aqui são silenciosas: uma corrompe o relatório
 * por município sem avisar, a outra manda o gestor procurar o problema no lugar
 * errado. Ver `decodificarPlanilha`.
 */
describe('decodificarPlanilha', () => {
  /** O que o Excel em português grava: um byte por acento, tabela 1252. */
  function comoExcelPtBr(texto: string): ArrayBuffer {
    const mapa: Record<string, number> = {
      'á': 0xe1, 'â': 0xe2, 'ã': 0xe3, 'à': 0xe0, 'é': 0xe9, 'ê': 0xea,
      'í': 0xed, 'ó': 0xf3, 'ô': 0xf4, 'õ': 0xf5, 'ú': 0xfa, 'ç': 0xe7,
      'Á': 0xc1, 'É': 0xc9, 'Ã': 0xc3, 'Ç': 0xc7,
    };
    const bytes = [...texto].map((c) => mapa[c] ?? c.charCodeAt(0));
    return new Uint8Array(bytes).buffer;
  }

  const utf8 = (t: string) => new TextEncoder().encode(t).buffer as ArrayBuffer;

  it('lê UTF-8 sem mexer em nada', () => {
    const r = decodificarPlanilha(utf8('Nome;Cidade\nMaria;Ji-Paraná\n'));
    expect(r.ok && r.texto).toContain('Ji-Paraná');
    expect(r.ok && r.latin).toBe(false);
  });

  it('salva o CSV que o Excel em português gera, em Windows-1252', () => {
    // Sem o segundo decodificador, "Ji-Paraná" viraria "Ji-Paran\uFFFD" e a
    // cidade não casaria com município nenhum.
    const r = decodificarPlanilha(comoExcelPtBr('Nome;Cidade\nMaria;Ji-Paraná\n'));
    expect(r.ok && r.texto).toContain('Ji-Paraná');
    expect(r.ok && r.latin).toBe(true);
    expect(r.ok && r.texto).not.toContain('\uFFFD');
  });

  it('acerta os municípios com apóstrofo, que são metade da lista de Rondônia', () => {
    const r = decodificarPlanilha(comoExcelPtBr("Cidade\nEspigão d'Oeste\nAlvorada d'Oeste\n"));
    expect(r.ok && r.texto).toContain("Espigão d'Oeste");
  });

  it('reconhece .xlsx pela assinatura de zip, sem depender da extensão', () => {
    const zip = new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00]).buffer;
    expect(decodificarPlanilha(zip)).toEqual({ ok: false, problema: 'planilha_binaria' });
  });

  it('tira o BOM, que grudaria no nome da primeira coluna', () => {
    const r = decodificarPlanilha(utf8('\uFEFFTelefone;Nome\n69999990000;Maria\n'));
    expect(r.ok && r.texto.startsWith('Telefone')).toBe(true);
  });

  it('arquivo vazio é recusado com motivo, não parseado', () => {
    expect(decodificarPlanilha(utf8('   \n'))).toEqual({ ok: false, problema: 'vazio' });
  });

  it('o texto decodificado casa com a lista fechada de municípios', () => {
    // O teste que fecha o ciclo: é este casamento que a corrupção quebrava.
    const r = decodificarPlanilha(comoExcelPtBr('Ji-Paraná'));
    const municipios = [{ id: 24, nome: 'Ji-Paraná' }];
    expect(casarMunicipio(r.ok ? r.texto : '', municipios)).toBe(24);
  });
});
