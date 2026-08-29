/**
 * O roteiro da conversa, do "oi" até depois da eleição.
 *
 * Não confundir com os MODELOS do gestor (`variacoes` / `modelos_livres`).
 * Aqueles o painel monta e o atendente dispara com um botão — são os textos que
 * a operação manda em nome da campanha, e por isso passam por `validarModelo`,
 * por rotação de variação e por link rastreado. Este aqui é outra coisa: é o
 * que o atendente responde COM AS PRÓPRIAS MÃOS quando a pessoa escreve algo
 * que o botão não cobre.
 *
 * ⚠️ Por que fica no código, e não em tabela editável pelo gestor:
 *
 * Ele não é enviado por nada. É material de consulta, irmão do "Como agir" da
 * lateral — e o "Como agir" também é código, pelo mesmo motivo. Guardar em
 * tabela criaria um segundo lugar onde texto de conversa pode ser escrito sem
 * passar por nenhuma revisão, e o painel só tem um lugar assim de propósito
 * (Gestor → Mensagens). Se um dia o gestor precisar reescrever isto sozinho,
 * o caminho certo é levar o roteiro para `modelos_livres`, não abrir uma
 * terceira porta.
 *
 * Fonte: SCRIPTAPOIO ("Declarando meu apoio na minha lista"), 28/08/2026.
 *
 * ⚠️ Arquivo NEUTRO de propósito (sem `'use client'`): o Server Component da
 * página e o componente de cliente que copia os textos importam os dois daqui.
 * Ver CLAUDE.md §3.1 — constante exportada de módulo `'use client'` chega ao
 * servidor como referência, e o array deixa de ser array.
 */

export type BlocoDoScript = {
  numero: number;
  titulo: string;
  /** Uma linha dizendo em que momento da conversa este bloco entra. */
  quando?: string;
  /** As opções de texto. Escolha uma, não mande as três. */
  falas: string[];
  /** O que não fazer, e por quê. */
  nota?: string;
  /** Frases que funcionam de verdade — só no bloco do motivo. */
  exemplos?: string[];
  /** O que não convence — só no bloco do motivo. */
  evite?: string;
  /** Qual botão do painel marcar depois desta resposta. */
  marque?: string;
  /**
   * O painel monta este texto sozinho, com o link rastreado dentro.
   *
   * ⚠️ Quando é `true`, a tela NÃO oferece copiar. O link de material e o
   * convite de canal saem de `/r/{token}`, que é o que liga o clique àquela
   * pessoa; texto copiado à mão com um link colado de outro lugar produz
   * métrica falsa e tira do ar a única medida confiável do projeto
   * (docs/02-CONSTRUCAO-TECNICA.md §8, `src/lib/bots.ts`).
   */
  montaNoPainel?: boolean;
};

export const ABERTURA_DO_SCRIPT = {
  titulo: 'Declarando meu apoio na minha lista',
  linha:
    'Sem “projeto”, sem “campanha”. É você contando pra quem te conhece em quem você votou e ' +
    'por quê.',
};

export const SCRIPT: BlocoDoScript[] = [
  {
    numero: 1,
    titulo: 'Abertura',
    quando: 'A primeira mensagem, sozinha.',
    falas: [
      'Oi! {{saudacao}}! Tudo bem?',
      'Oi, quanto tempo! Tudo bem por aí?',
      '{{saudacao}}! Tudo certo? Sumido(a), hein!',
    ],
    nota: 'Manda só isso e espera responder. Não emenda o assunto na mesma mensagem.',
  },
  {
    numero: 2,
    titulo: 'Contar — o coração do script',
    quando: 'Depois que a pessoa respondeu o oi.',
    falas: [
      'Que bom! Então, tô te chamando porque decidi quem eu quero na Câmara Federal esse ano e ' +
        'resolvi contar pras pessoas que eu gosto. Escolhi {{candidato}}. [O SEU MOTIVO]. Achei ' +
        'que valia te falar.',
      'Ó, tava querendo te falar uma coisa. Já decidi meu voto pra {{cargo}} e escolhi ' +
        '{{candidato}}. [O SEU MOTIVO]. Como eu confio em você, quis te contar.',
      'Então, uma coisa que eu queria te dizer: esse ano eu vou de {{candidato}} pra {{cargo}}. ' +
        '[O SEU MOTIVO]. Tô falando com as pessoas próximas porque acho importante.',
    ],
    nota:
      'O MOTIVO é o que faz a mensagem funcionar. Escreva o seu, verdadeiro e específico — é a ' +
      'única parte que não dá para copiar de ninguém.',
    exemplos: [
      'Acompanho o trabalho dela desde 2022 e foi a única que apareceu aqui na região quando ' +
        'ninguém veio.',
      'Conheci ela de perto e é uma pessoa séria, dessas que responde mensagem e resolve.',
      'Vi ela brigar pela [pauta] quando não dava voto nenhum. Isso me convenceu.',
      'Ela é a única que fala de [tema] de um jeito que eu entendo e acredito.',
    ],
    evite:
      '“é uma ótima pessoa”, “vai fazer muito pela cidade”, “é honesta”. Genérico demais, soa ' +
      'decorado.',
  },
  {
    numero: 3,
    titulo: 'Pedir',
    quando: 'Logo depois de contar. Sem link ainda.',
    falas: [
      'Posso te mandar o material dela pra você dar uma olhada?',
      'Se você quiser, te mando as propostas dela. Pode ser?',
      'Queria te mandar o material dela pra você conhecer. Tudo bem?',
    ],
  },
  {
    numero: 4,
    titulo: 'Material — depois do “pode”',
    quando: 'Só depois de a pessoa autorizar.',
    montaNoPainel: true,
    falas: [
      'Valeu! Esse é o material dela — {{candidato}}, {{cargo}}, número {{numero}}:\n\n' +
        '{{link}}\n\n' +
        'Dá uma olhada com calma. Se ficar alguma dúvida, me pergunta que eu te respondo.',
      'Obrigado por deixar eu te mostrar! {{candidato}}, {{numero}}:\n\n' +
        '{{link}}\n\n' +
        'Vê quando puder. Se quiser saber a posição dela sobre algum assunto específico, me fala.',
    ],
    marque: 'Autorizou — e o painel abre o material já com o link certo',
  },
  {
    numero: 5,
    titulo: 'Se disser não',
    falas: [
      'Sem problema! Só queria te contar mesmo, não vou te encher. Abraço!',
      'Tranquilo, respeito. Era só pra te falar. Um abraço!',
    ],
    nota: 'Encerra ali. Não insiste, não manda nada depois, não pergunta de novo.',
    marque: 'Pediu saída',
  },
  {
    numero: 6,
    titulo: 'Se disser “já voto em outro”',
    falas: [
      'Tudo certo, respeito demais. Cada um vota em quem acredita. Só quis te contar a minha ' +
        'escolha. Abraço!',
      'Boa, o importante é votar consciente. Era só pra dividir minha escolha com você. Abraço!',
    ],
    nota: 'Não argumenta, não tenta virar. Isso queima a relação e não muda voto.',
    marque: 'Pediu saída — e NÃO anote em quem a pessoa vota',
  },
  {
    numero: 7,
    titulo: 'Se perguntar “quem é ela?” / “por que ela?”',
    falas: [
      'Ela é {{candidato}}, tá concorrendo a {{cargo}}, número {{numero}}. [O SEU MOTIVO, em duas ' +
        'ou três frases — fala do que você viu, não do que te contaram.] Se quiser, te mando o ' +
        'material dela.',
    ],
  },
  {
    numero: 8,
    titulo: 'Se perguntar “você ganha algo com isso?”',
    falas: [
      'Não ganho nada, não. Tô falando porque acredito nela mesmo e quis contar pras pessoas ' +
        'próximas.',
    ],
  },
  {
    numero: 9,
    titulo: 'Se pedir emprego, dinheiro, favor',
    falas: [
      'Ah, isso eu não posso prometer, nem seria certo. Mas se você quiser, eu levo sua pergunta ' +
        'pra equipe dela pra te responderem direito.',
    ],
    nota: 'Nunca prometa nada. Nem “vou ver com ela”, nem “acho que dá”.',
    marque: 'Encaminhar',
  },
  {
    numero: 10,
    titulo: 'Se quiser ajudar também',
    falas: ['Sério? Que legal! Posso passar seu contato pra equipe dela te chamar?'],
    marque: 'Quer ajudar',
  },
  {
    numero: 11,
    titulo: 'Se pedir pra entrar no grupo/canal',
    montaNoPainel: true,
    falas: [
      'Tem sim! Eu não adiciono ninguém, você entra pelo link se quiser:\n\n' +
        '{{link_grupo}}\n\n' +
        'E sai quando quiser também.',
    ],
    nota: 'NUNCA adicione ninguém na mão. Só o link, e só se pedirem.',
    marque: 'Convite ao canal, no painel',
  },
  {
    numero: 12,
    titulo: 'Se não responder',
    falas: [],
    nota:
      'Nada. Não manda “oi?”, não insiste. Se responder daqui a três dias, você continua a ' +
      'conversa normalmente do ponto onde parou — abra por “Meus contatos”.',
  },
  {
    numero: 13,
    titulo: 'Pedir indicação (só pra quem gostou)',
    falas: [
      'Ó, se você achar que alguém aí pode gostar de conhecer o trabalho dela, fica à vontade pra ' +
        'passar o material. Mas só se você quiser mesmo, sem compromisso!',
    ],
    nota:
      'Essa é a mensagem que faz sua base crescer sozinha. Só mande pra quem demonstrou interesse ' +
      'de verdade.',
  },
  {
    numero: 14,
    titulo: 'Lembrete perto da eleição (uma vez só, na semana)',
    falas: [
      'Oi! Tudo bem? Passando só pra lembrar: domingo é a eleição. {{candidato}}, {{numero}}, pra ' +
        '{{cargo}}. Se puder, anota aí. Abraço!',
    ],
    nota: 'Uma vez. Não é para repetir no sábado nem no domingo.',
  },
  {
    numero: 15,
    titulo: 'Depois da eleição',
    falas: [
      'Oi! Obrigado por ter me ouvido nessas semanas, viu? Independente do resultado, valeu de ' +
        'verdade. Abraço!',
    ],
  },
];

export const REGRAS_DO_SCRIPT: string[] = [
  'Escreva do seu jeito. O script é referência. Se você não fala “tô”, escreva “estou”.',
  'O motivo tem que ser seu. Específico, coisa que você viu. É a única parte que convence.',
  'Você tem que apoiar de verdade. Se não apoia, não faça.',
  '“Não” encerra na hora. Sem insistir, sem argumentar.',
  'Não prometa nada a ninguém. Emprego, dinheiro, favor: nem cogite.',
  'Não adicione ninguém em grupo. Só link, se pedirem.',
  'Uma conversa por vez, no seu ritmo. Não é distribuição, é conversa.',
  'Perfil é seu. Seu nome, sua foto. Nada de foto da candidata.',
];

/** Os dados que o roteiro precisa para deixar de falar em [CANDIDATO]. */
export type DadosDoScript = {
  candidato: string | null;
  cargo: string | null;
  numero: string | null;
  saudacao: string;
};

/**
 * Troca as variáveis do roteiro pelos dados de quem o atendente atende.
 *
 * Deliberadamente NÃO substitui `{{link}}` nem `{{link_grupo}}`: esses dois só
 * existem por contato, e quem os monta é o painel. Ver `montaNoPainel`.
 */
export function preencherScript(texto: string, dados: DadosDoScript): string {
  return texto
    .replaceAll('{{saudacao}}', dados.saudacao)
    .replaceAll('{{candidato}}', dados.candidato ?? '[CANDIDATO]')
    .replaceAll('{{cargo}}', dados.cargo ?? '[CARGO]')
    .replaceAll('{{numero}}', dados.numero ?? '[NÚMERO]');
}
