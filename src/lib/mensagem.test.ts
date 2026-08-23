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
  // A página do candidato, com as peças dentro. É o {{link}} do Material.
  link: 'https://lnk.exemplo.br/r/pag789',
  linkGrupo: 'https://whatsapp.com/channel/xyz',
  municipio: 'Porto Velho',
  agora: new Date('2026-08-24T13:00:00Z'), // 09:00 em Porto Velho
  timezone: RONDONIA,
};

// Os textos oficiais, como estão no banco. Se algum deixar de passar na
// validação, ou o texto ou o validador está errado — os dois precisam
// concordar, senão o gestor não consegue salvar os textos oficiais.
//
// A frase de procedência é {{origem}} e não texto escrito: quem veio da lista
// foi indicado por um apoiador, quem veio do site pediu o material sozinho.
// Escrita à mão, a mesma frase sairia para os dois — e para um deles seria
// mentira.
const PERMISSOES = [
  '{{saudacao}}, {{primeiro_nome}}! Tudo bem? Aqui é {{nome}}. Tô ajudando {{candidatos}} nessa eleição, e {{origem}}. Posso te mandar o material aqui? Se não quiser, me fala que eu paro por aqui e apago seu número, tranquilo.',
  'Oi, {{primeiro_nome}}! {{saudacao}}. Sou {{nome}}. Tô nessa eleição com {{candidatos}}, e {{origem}}. Tudo bem se eu te mandar as propostas? Se preferir não receber, é só me dizer que apago seu contato.',
  '{{saudacao}}, {{primeiro_nome}}, tudo certo? {{nome}} aqui. Tô dando uma força pra {{candidatos}}, e {{origem}}. Posso te mostrar o material por aqui? Se não quiser, sem problema, me avisa que apago seu número.',
  '{{saudacao}}, {{primeiro_nome}}! Aqui é {{nome}}. Tô ajudando {{candidatos}} e {{origem}}. Te mando o material? Se não quiser, me fala que apago seu número e não te chamo mais.',
  'Oi, {{primeiro_nome}}! {{saudacao}}, tudo bem por aí? Eu sou {{nome}}, tô nessa eleição ajudando {{candidatos}}, e {{origem}}. Posso te mandar as propostas aqui no WhatsApp? Se preferir que não, me fala que apago seu contato, de boa.',
];

const MATERIAL = `Que bom, {{primeiro_nome}}! Esse é o material de {{candidato}}, {{cargo}}, número {{numero}}:
{{link}}
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

  // O Material manda UM link: a página do candidato. Quatro URLs cruas numa
  // mensagem de WhatsApp parecem disparo, e nenhuma delas carrega a
  // identificação da propaganda nem o botão de sair.
  it('o Material se identifica sozinho e manda um link só', () => {
    const texto = montarTexto(MATERIAL, CTX);
    expect(texto).toContain('Fulano de Tal, deputado federal, número 1234');
    expect(texto).toContain('https://lnk.exemplo.br/r/pag789');
    expect(texto).toContain('CNPJ 12.345.678/0001-90');
    expect(texto.match(/https?:\/\//g) ?? []).toHaveLength(1);
    expect(texto).not.toMatch(/\{\{|\}\}/);
  });

  // {{materiais}} continua existindo: é o que o convite ao canal usa, e ali o
  // objetivo é a pessoa cair DENTRO do canal, não numa página sobre ele.
  it('{{materiais}} lista cada peça com o link próprio', () => {
    const texto = montarTexto('Olha: {{materiais}}', CTX);
    expect(texto).toContain('Santinho: https://lnk.exemplo.br/r/abc123');
    expect(texto).toContain('Propostas: https://lnk.exemplo.br/r/def456');
  });

  // A frase de procedência é escolhida pelo servidor, não escrita no texto.
  // Dizer "um apoiador me passou seu contato" para quem preencheu o formulário
  // sozinho é afirmar um fato que não aconteceu, para a dona do dado.
  it('{{origem}} conta a verdade sobre como chegamos na pessoa', () => {
    const fria = montarTexto(PERMISSOES[0], { ...CTX, origemContato: 'lista_fria' });
    expect(fria).toContain('um apoiador me passou seu contato');

    const site = montarTexto(PERMISSOES[0], { ...CTX, origemContato: 'site' });
    expect(site).toContain('você deixou seu contato no site');
    expect(site).not.toContain('apoiador');

    const kit = montarTexto(PERMISSOES[0], { ...CTX, origemContato: 'kit' });
    expect(kit).toContain('você pediu material pelo site');
    expect(kit).not.toContain('apoiador');
  });

  // Sem origem informada, o texto assume o caso que precisa da explicação:
  // a lista. Assumir "você pediu" seria inventar um consentimento.
  it('sem origem, assume a lista fria', () => {
    expect(montarTexto(PERMISSOES[0], CTX)).toContain('um apoiador me passou seu contato');
  });

  // A variável entra sempre no meio da frase — o texto dela começa em
  // minúscula, e virar início de período sairia "um apoiador me passou...".
  it('nenhuma Permissão oficial começa período com {{origem}}', () => {
    for (const p of PERMISSOES) {
      expect(p).not.toMatch(/(^|[.!?]\s+)\{\{origem\}\}/);
    }
  });

  it('contato sem nome não gera "Bom dia, !"', () => {
    const texto = montarTexto(PERMISSOES[0], { ...CTX, primeiroNome: null });
    expect(texto).not.toMatch(/,\s*!/);
    expect(texto).not.toMatch(/\s,/);
    expect(texto.startsWith('Bom dia!')).toBe(true);
  });

  it('contato sem nome no meio da frase também sai limpo', () => {
    const texto = montarTexto(PERMISSOES[1], { ...CTX, primeiroNome: null });
    expect(texto.startsWith('Oi! Bom dia.')).toBe(true);
    expect(texto).not.toMatch(/,\s*,/);
  });

  // A saudação é capitalizada porque quase sempre abre a mensagem. Se cair no
  // meio de um período, sai "Oi, Joana, Boa tarde!" — maiúscula solta.
  it('nenhuma Permissão oficial põe a saudação no meio da frase', () => {
    for (const p of PERMISSOES) {
      expect(p).not.toMatch(/,\s*\{\{saudacao\}\}/);
    }
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
    const texto = 'Oi {{primeiro_nome}}, {{origem}}. Posso mandar? Se não quiser eu apago.';
    expect(codigos('permissao', texto)).toContain('falta_chapa');
  });

  // Escrever a procedência à mão é o defeito, não a solução: a frase certa
  // depende de onde a pessoa veio, e o texto é um só para todo mundo.
  it('Permissão sem {{origem}} — nem escrevendo a frase à mão', () => {
    const semNada = 'Oi {{primeiro_nome}}, tô com {{candidatos}}. Posso mandar o material? Se não quiser, apago seu número.';
    expect(codigos('permissao', semNada)).toContain('falta_origem');

    const escritaAMao = 'Oi {{primeiro_nome}}, tô com {{candidatos}} e um apoiador me passou seu contato. Posso mandar? Se não quiser, apago.';
    expect(codigos('permissao', escritaAMao)).toContain('falta_origem');
  });

  it('Permissão sem a frase de parar e apagar', () => {
    const texto = 'Oi {{primeiro_nome}}, tô com {{candidatos}} e {{origem}}. Posso mandar o material?';
    expect(codigos('permissao', texto)).toContain('falta_frase_parar');
  });

  it('Permissão com link', () => {
    const base = 'Oi {{primeiro_nome}}, {{candidatos}}, {{origem}}';
    expect(codigos('permissao', `${base}: {{link}}. Se não quiser, apago.`)).toContain('link_na_permissao');
    expect(codigos('permissao', `${base}: {{materiais}}. Se não quiser, apago.`)).toContain('link_na_permissao');
    expect(codigos('permissao', `${base}: https://x.br. Se não quiser, apago.`)).toContain('link_na_permissao');
  });

  it('Permissão com emoji', () => {
    const texto = 'Oi {{primeiro_nome}} 😊, tô com {{candidatos}} e {{origem}}. Se não quiser, apago.';
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
