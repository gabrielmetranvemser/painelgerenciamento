import { describe, expect, it } from 'vitest';
import {
  horaLocal,
  listarChapa,
  montarTexto,
  podeSalvar,
  primeiroNomeDe,
  proximaVariacao,
  saudacao,
  validarModelo,
  variaveisUsadas,
  type ContextoMensagem,
} from './mensagem';

const RONDONIA = 'America/Porto_Velho'; // UTC−4

const CHAPA = [
  { nome: 'Fulano de Tal', cargo: 'deputado_federal', numero: '1234' },
  { nome: 'Beltrana Souza', cargo: 'governador', numero: '12' },
];

const CTX: ContextoMensagem = {
  primeiroNome: 'João',
  nomeAtendente: 'Lucas',
  chapa: CHAPA,
  candidato: 'Fulano de Tal',
  cargo: 'deputado_federal',
  numero: '1234',
  partido: 'PXX',
  cnpj: '12.345.678/0001-90',
  materiais: [
    { titulo: 'Santinho', url: 'https://lnk.exemplo.br/r/abc123' },
    { titulo: 'Propostas', url: 'https://lnk.exemplo.br/r/def456' },
  ],
  linkGrupo: 'https://whatsapp.com/channel/xyz',
  municipio: 'Porto Velho',
  agora: new Date('2026-08-24T13:00:00Z'), // 09:00 em Porto Velho
  timezone: RONDONIA,
};

// Os textos exatos de docs/03-OPERACAO.md §8. Se algum deixar de passar na
// validação, ou o documento ou o validador está errado — os dois precisam
// concordar, senão o gestor não consegue salvar os textos oficiais.
const PERMISSOES = [
  '{{saudacao}}, {{primeiro_nome}}! Tudo bem? Aqui é {{nome}}. Tô ajudando {{candidatos}} nessa eleição, e um apoiador me passou seu contato. Posso te mandar o material aqui? Se não quiser, me fala que eu paro por aqui e apago seu número, tranquilo.',
  'Oi, {{primeiro_nome}}, {{saudacao}}! Sou {{nome}}. Tô nessa eleição com {{candidatos}}. Um apoiador me passou seu contato. Tudo bem se eu te mandar as propostas? Se preferir não receber, é só me dizer que apago seu contato.',
  '{{saudacao}}, {{primeiro_nome}}, tudo certo? {{nome}} aqui. Tô dando uma força pra {{candidatos}}, e um apoiador me indicou seu contato. Posso te mostrar o material por aqui? Se não quiser, sem problema, me avisa que apago seu número.',
  '{{saudacao}}, {{primeiro_nome}}! Aqui é {{nome}}. Tô ajudando {{candidatos}} e um apoiador me passou seu contato. Te mando o material? Se não quiser, me fala que apago seu número e não te chamo mais.',
  'Oi, {{primeiro_nome}}, {{saudacao}}, tudo bem por aí? Eu sou {{nome}}, tô nessa eleição ajudando {{candidatos}}. Um apoiador me passou seu contato. Posso te mandar as propostas aqui no WhatsApp? Se preferir que não, me fala que apago seu contato, de boa.',
];

const MATERIAL = `Que bom, {{primeiro_nome}}! Esse é o material de {{candidato}}, {{cargo}}, número {{numero}}:
{{materiais}}
Se um dia não quiser mais receber, me avisa que apago seu contato.
Propaganda de {{candidato}} — CNPJ {{cnpj}}`;

describe('horaLocal / saudacao — precisa respeitar o fuso de Rondônia', () => {
  it('converte UTC para a hora de Porto Velho (UTC−4)', () => {
    expect(horaLocal(new Date('2026-08-24T13:00:00Z'), RONDONIA)).toBe(9);
    expect(horaLocal(new Date('2026-08-24T23:59:00Z'), RONDONIA)).toBe(19);
    expect(horaLocal(new Date('2026-08-24T03:00:00Z'), RONDONIA)).toBe(23);
  });

  it('meia-noite local é 0, não 24', () => {
    expect(horaLocal(new Date('2026-08-24T04:00:00Z'), RONDONIA)).toBe(0);
  });

  it.each([
    ['2026-08-24T13:00:00Z', 'Bom dia'],   // 09:00 local
    ['2026-08-24T15:59:00Z', 'Bom dia'],   // 11:59 local
    ['2026-08-24T16:00:00Z', 'Boa tarde'], // 12:00 local
    ['2026-08-24T21:59:00Z', 'Boa tarde'], // 17:59 local
    ['2026-08-24T22:00:00Z', 'Boa noite'], // 18:00 local
  ])('%s → %s', (iso, esperada) => {
    expect(saudacao(new Date(iso), RONDONIA)).toBe(esperada);
  });

  it('usar o fuso errado produziria a saudação errada — é o bug que isto previne', () => {
    const meioDiaEmRondonia = new Date('2026-08-24T16:00:00Z');
    expect(saudacao(meioDiaEmRondonia, RONDONIA)).toBe('Boa tarde');
    expect(saudacao(meioDiaEmRondonia, 'UTC')).toBe('Boa tarde');
    const fimDeTardeEmRondonia = new Date('2026-08-24T21:00:00Z'); // 17h local, 21h UTC
    expect(saudacao(fimDeTardeEmRondonia, RONDONIA)).toBe('Boa tarde');
    expect(saudacao(fimDeTardeEmRondonia, 'UTC')).toBe('Boa noite'); // erraria
  });
});

describe('primeiroNomeDe — planilha de campanha vem suja', () => {
  it.each([
    ['JOSE DA SILVA', 'Jose'],
    ['maria   souza', 'Maria'],
    ['  Ana Paula  ', 'Ana'],
    ['ANTONIO', 'Antonio'],
    ['DE OLIVEIRA MARCOS', 'Oliveira'],
    ["d'avila neto", "D'Avila"],
    ['ana-clara ribeiro', 'Ana-Clara'],
    ['SR. ANTONIO CARLOS', 'Antonio'],
    ['João123', 'João'],
    ['MARIA JOSÉ', 'Maria'],
  ])('%s → %s', (entrada, esperado) => {
    expect(primeiroNomeDe(entrada)).toBe(esperado);
  });

  it.each(['', '   ', '-', '...', 'SEM NOME', null, undefined, '123456', 'A'])(
    '%s não dá nome utilizável',
    (entrada) => {
      expect(primeiroNomeDe(entrada as string)).toBeNull();
    },
  );
});

describe('montarTexto', () => {
  it('a Permissão declara a chapa inteira', () => {
    const texto = montarTexto(PERMISSOES[0], CTX);
    expect(texto).toContain('Bom dia, João!');
    expect(texto).toContain('Aqui é Lucas.');
    // É isto que torna o consentimento específico: a pessoa lê de quem vai
    // receber material ANTES de dizer "pode".
    expect(texto).toContain('Fulano de Tal (deputado federal) e Beltrana Souza (governador)');
    expect(texto).not.toMatch(/\{\{|\}\}/);
  });

  it('o Material se identifica sozinho e lista as peças', () => {
    const texto = montarTexto(MATERIAL, CTX);
    expect(texto).toContain('Fulano de Tal, deputado federal, número 1234');
    expect(texto).toContain('Santinho: https://lnk.exemplo.br/r/abc123');
    expect(texto).toContain('Propostas: https://lnk.exemplo.br/r/def456');
    expect(texto).toContain('CNPJ 12.345.678/0001-90');
    expect(texto).not.toMatch(/\{\{|\}\}/);
  });

  it('contato sem nome não gera "Bom dia, !"', () => {
    const texto = montarTexto(PERMISSOES[0], { ...CTX, primeiroNome: null });
    expect(texto).not.toMatch(/,\s*!/);
    expect(texto).not.toMatch(/\s,/);
    expect(texto.startsWith('Bom dia!')).toBe(true);
  });

  it('contato sem nome no meio da frase também sai limpo', () => {
    const texto = montarTexto(PERMISSOES[1], { ...CTX, primeiroNome: null });
    expect(texto.startsWith('Oi, Bom dia!')).toBe(true);
    expect(texto).not.toMatch(/,\s*,/);
  });

  it('variável desconhecida é preservada, não apagada silenciosamente', () => {
    expect(montarTexto('Olá {{inexistente}}', CTX)).toContain('{{inexistente}}');
  });

  it('aceita espaços dentro das chaves', () => {
    expect(montarTexto('Oi {{ primeiro_nome }}', CTX)).toBe('Oi João');
  });

  it('a saudação sai pelo fuso do contexto', () => {
    const tarde = { ...CTX, agora: new Date('2026-08-24T20:00:00Z') }; // 16h local
    expect(montarTexto('{{saudacao}}', tarde)).toBe('Boa tarde');
  });
});

describe('variaveisUsadas', () => {
  it('lista na ordem de aparição', () => {
    expect(variaveisUsadas('{{saudacao}}, {{primeiro_nome}}! Sou {{nome}}.')).toEqual([
      'saudacao',
      'primeiro_nome',
      'nome',
    ]);
  });
});

describe('validarModelo — os textos oficiais do documento precisam passar', () => {
  it.each(PERMISSOES.map((t, i) => [i + 1, t] as const))(
    'Permissão variação %i é salvável',
    (_i, texto) => {
      const problemas = validarModelo('permissao', texto);
      expect(problemas.filter((p) => p.bloqueia)).toEqual([]);
      expect(podeSalvar(problemas)).toBe(true);
    },
  );

  it('Material é salvável', () => {
    expect(podeSalvar(validarModelo('material', MATERIAL))).toBe(true);
  });

  it('o Material oficial traz o CNPJ, então não gera o aviso', () => {
    expect(validarModelo('material', MATERIAL).map((x) => x.codigo)).not.toContain('falta_cnpj');
  });

  it('Material sem CNPJ avisa, mas não impede salvar', () => {
    const semCnpj = MATERIAL.replace(' — CNPJ {{cnpj}}', '');
    const p = validarModelo('material', semCnpj);
    expect(p.map((x) => x.codigo)).toContain('falta_cnpj');
    expect(p.find((x) => x.codigo === 'falta_cnpj')?.bloqueia).toBe(false);
    expect(podeSalvar(p)).toBe(true);
  });

  it('etapas simples não exigem os blocos travados', () => {
    expect(podeSalvar(validarModelo('saida', 'Tranquilo, {{primeiro_nome}}. Já tirei seu número da lista.'))).toBe(true);
    expect(podeSalvar(validarModelo('quer_ajudar', 'Que ótimo, {{primeiro_nome}}!'))).toBe(true);
  });
});

describe('listarChapa — é o que faz o consentimento ser específico', () => {
  it.each([
    [[{ nome: 'A', cargo: 'deputado_federal' }], 'A (deputado federal)'],
    [[{ nome: 'A', cargo: 'deputado_federal' }, { nome: 'B', cargo: 'governador' }],
     'A (deputado federal) e B (governador)'],
    [[{ nome: 'A', cargo: 'deputado_federal' }, { nome: 'B', cargo: 'governador' },
      { nome: 'C', cargo: 'senador' }],
     'A (deputado federal), B (governador) e C (senador)'],
  ])('%j → %s', (chapa, esperado) => {
    expect(listarChapa(chapa)).toBe(esperado);
  });

  it('chapa vazia não produz texto solto', () => {
    expect(listarChapa([])).toBe('');
  });

  it('não usa artigo antes do nome — o sistema não guarda o gênero', () => {
    const texto = listarChapa([{ nome: 'Maria', cargo: 'governador' }]);
    expect(texto).not.toMatch(/^[oa] /);
  });
});

describe('validarModelo — travas que impedem salvar', () => {
  function codigos(etapa: Parameters<typeof validarModelo>[0], texto: string) {
    return validarModelo(etapa, texto).filter((p) => p.bloqueia).map((p) => p.codigo);
  }

  it('texto vazio', () => {
    expect(codigos('permissao', '   ')).toEqual(['vazio']);
  });

  // A trava central do multi-candidato: sem declarar a chapa, a pessoa
  // autorizaria conhecendo um e receberia de vários.
  it('Permissão sem declarar a chapa', () => {
    const texto = 'Oi {{primeiro_nome}}, um apoiador me passou seu contato. Posso mandar? Se não quiser eu apago.';
    expect(codigos('permissao', texto)).toContain('falta_chapa');
  });

  it('Permissão sem a menção de como chegamos no contato', () => {
    const texto = 'Oi {{primeiro_nome}}, tô com {{candidatos}}. Posso mandar o material? Se não quiser, apago seu número.';
    expect(codigos('permissao', texto)).toContain('falta_mencao_apoiador');
  });

  it('Permissão sem a frase de parar e apagar', () => {
    const texto = 'Oi {{primeiro_nome}}, tô com {{candidatos}} e um apoiador me passou seu contato. Posso mandar o material?';
    expect(codigos('permissao', texto)).toContain('falta_frase_parar');
  });

  it('Permissão com link', () => {
    const base = 'Oi {{primeiro_nome}}, {{candidatos}}, um apoiador me passou seu contato';
    expect(codigos('permissao', `${base}: {{link}}. Se não quiser, apago.`)).toContain('link_na_permissao');
    expect(codigos('permissao', `${base}: {{materiais}}. Se não quiser, apago.`)).toContain('link_na_permissao');
    expect(codigos('permissao', `${base}: https://x.br. Se não quiser, apago.`)).toContain('link_na_permissao');
  });

  it('Permissão com emoji', () => {
    const texto = 'Oi {{primeiro_nome}} 😊, tô com {{candidatos}} e um apoiador me passou seu contato. Se não quiser, apago.';
    expect(codigos('permissao', texto)).toContain('emoji_na_permissao');
  });

  it('Material sem candidato e cargo — cada peça precisa se identificar', () => {
    const texto = 'Que bom! Olha o material, número {{numero}}: {{materiais}}. Se não quiser mais, apago seu contato.';
    expect(codigos('material', texto)).toContain('falta_candidato_cargo');
  });

  it('Material com candidato e cargo em frases separadas', () => {
    const texto = 'Material de {{candidato}}. Ele concorre a {{cargo}}, número {{numero}}: {{materiais}}. Se não quiser, apago.';
    expect(codigos('material', texto)).toContain('candidato_cargo_separados');
  });

  it('Material sem o número de urna', () => {
    const texto = 'Material de {{candidato}}, {{cargo}}: {{materiais}}. Se não quiser mais, apago seu contato.';
    expect(codigos('material', texto)).toContain('falta_numero');
  });

  it('Material sem link rastreado', () => {
    const texto = 'Material de {{candidato}}, {{cargo}}, número {{numero}}. Se não quiser mais, apago seu contato.';
    expect(codigos('material', texto)).toContain('falta_link');
  });

  it('Material aceita {{link}} no lugar de {{materiais}}', () => {
    const texto = 'Material de {{candidato}}, {{cargo}}, número {{numero}}: {{link}}. Se não quiser, apago.';
    expect(codigos('material', texto)).not.toContain('falta_link');
  });

  it('variável inventada', () => {
    expect(codigos('saida', 'Oi {{apelido}}')).toContain('variavel_desconhecida');
  });

  it('mensagem longa demais só avisa', () => {
    const texto = ['a', 'b', 'c', 'd', 'e', 'f'].join('\n');
    const p = validarModelo('saida', texto);
    expect(p.map((x) => x.codigo)).toContain('linhas_demais');
    expect(podeSalvar(p)).toBe(true);
  });
});

describe('proximaVariacao — o mesmo chip não repete o texto em seguida', () => {
  const vs = [{ id: 'a' }, { id: 'b' }, { id: 'c' }];

  it('sem histórico começa pela primeira', () => {
    expect(proximaVariacao(vs, null).id).toBe('a');
    expect(proximaVariacao(vs, undefined).id).toBe('a');
  });

  it('avança circularmente', () => {
    expect(proximaVariacao(vs, 'a').id).toBe('b');
    expect(proximaVariacao(vs, 'b').id).toBe('c');
    expect(proximaVariacao(vs, 'c').id).toBe('a');
  });

  it('nunca devolve a mesma de novo quando há mais de uma', () => {
    let ultima: string | null = null;
    for (let i = 0; i < 20; i++) {
      const proxima: string = proximaVariacao(vs, ultima).id;
      expect(proxima).not.toBe(ultima);
      ultima = proxima;
    }
  });

  it('percorre todas antes de repetir', () => {
    const vistas: string[] = [];
    let ultima: string | null = null;
    for (let i = 0; i < 3; i++) {
      ultima = proximaVariacao(vs, ultima).id;
      vistas.push(ultima);
    }
    expect(new Set(vistas).size).toBe(3);
  });

  it('variação removida do modelo não trava a rotação', () => {
    expect(proximaVariacao(vs, 'id-que-nao-existe-mais').id).toBe('a');
  });

  it('com uma variação só, devolve ela', () => {
    expect(proximaVariacao([{ id: 'unica' }], 'unica').id).toBe('unica');
  });

  it('modelo sem variação é erro de configuração, não silêncio', () => {
    expect(() => proximaVariacao([], null)).toThrow(/sem nenhuma variação/);
  });
});
