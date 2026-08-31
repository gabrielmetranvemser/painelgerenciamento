/**
 * Montagem e validação das mensagens que o atendente envia.
 *
 * ⚠️ Não alterar as regras de bloco travado sem falar com quem responde
 *    juridicamente pela campanha. Elas existem para sustentar a posição de
 *    "pessoa natural conversando de forma privada" (docs/01-VISAO-GERAL.md §9.2).
 *
 * O sistema monta o texto; quem revisa e envia é o atendente, no WhatsApp dele.
 */

export type Etapa =
  /** Só o "oi". Nada de assunto, nada de link, nada de nome de candidato. */
  | 'abertura'
  /** O atendente conta em quem votou e por quê. */
  | 'minha_escolha'
  | 'permissao'
  | 'material'
  | 'saida'
  | 'quem_passou'
  | 'quer_ajudar'
  | 'encaminhamento'
  | 'convite_grupo'
  /**
   * Mensagem que o gestor escreveu, fora das sete etapas.
   *
   * Não ganha regra de conteúdo própria: o que vale para ela é só o que vale
   * para qualquer texto — não pode ser vazio e não pode usar variável que não
   * existe. As regras das outras etapas são sobre o PAPEL de cada uma na
   * conversa (a permissão declara a chapa, o material se identifica), e uma
   * mensagem livre não tem papel fixo. O aviso de linhas demais continua
   * valendo, porque texto longo parece panfleto em qualquer etapa.
   */
  | 'livre';

export const VARIAVEIS_CONHECIDAS = [
  'saudacao',
  'primeiro_nome',
  'nome',
  /** A chapa inteira, com cargo de cada um. É o que a Permissão declara. */
  'candidatos',
  /** Como chegamos até esta pessoa. Muda conforme a origem do contato. */
  'origem',
  /** Os quatro abaixo são do candidato DAQUELA mensagem, no Material. */
  'candidato',
  'cargo',
  'numero',
  'partido',
  'cnpj',
  /** Primeiro material do candidato. */
  'link',
  /** Todos os materiais do candidato, um por linha, com o nome de cada peça. */
  'materiais',
  'link_grupo',
  'municipio',
] as const;

export type Variavel = (typeof VARIAVEIS_CONHECIDAS)[number];

export type CandidatoNaChapa = {
  nome: string;
  cargo: string;
  numero?: string | null;
  partido?: string | null;
};

export type MaterialComLink = { titulo: string; url: string };

export type OrigemDoContato = 'site' | 'kit' | 'lista_fria' | 'chamou';

/**
 * Como chegamos até a pessoa — a frase de {{origem}}.
 *
 * NÃO é editável pelo gestor de propósito. É uma afirmação de fato sobre a
 * procedência do dado, e a pessoa tem direito de saber a verdade sobre isso.
 * Com texto livre, bastava o gestor escrever "um apoiador me passou seu
 * contato" numa mensagem só e ela sairia também para quem preencheu o
 * formulário com o próprio dedo — dizendo a essa pessoa uma coisa que não
 * aconteceu.
 */
const FRASE_ORIGEM: Record<OrigemDoContato, string> = {
  lista_fria: 'um apoiador me passou seu contato',
  site: 'você deixou seu contato no site pedindo o material',
  kit: 'você pediu material pelo site',
  chamou: 'você me chamou aqui no WhatsApp',
};

export type ContextoMensagem = {
  /** primeiro nome do contato, já tratado por `primeiroNomeDe` */
  primeiroNome: string | null;
  /** De onde veio o contato. Decide a frase de {{origem}}. */
  origemContato?: OrigemDoContato | null;
  /** primeiro nome do ATENDENTE — a mensagem é assinada por ele, não pela campanha */
  nomeAtendente: string;
  /** A chapa do atendente, na ordem de leitura. Alimenta {{candidatos}}. */
  chapa?: CandidatoNaChapa[];
  /** O candidato desta mensagem, quando ela é de um só. */
  candidato?: string | null;
  cargo?: string | null;
  numero?: string | null;
  partido?: string | null;
  cnpj?: string | null;
  materiais?: MaterialComLink[];
  link?: string | null;
  linkGrupo?: string | null;
  municipio?: string | null;
  agora: Date;
  timezone: string;
};

// ─────────────────────────────────────────────────────────────────────────────
// Saudação por hora local
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Hora local (0–23) no fuso da operação.
 *
 * ⚠️ Sempre passar pelo fuso configurado. O servidor roda em UTC e Rondônia é
 * UTC−4: usar a hora do servidor mandaria "boa noite" às 4 da tarde.
 */
export function horaLocal(agora: Date, timezone: string): number {
  const formatada = new Intl.DateTimeFormat('pt-BR', {
    timeZone: timezone,
    hour: 'numeric',
    hourCycle: 'h23',
  }).format(agora);
  return Number(formatada);
}

export function saudacao(agora: Date, timezone: string): string {
  const h = horaLocal(agora, timezone);
  if (h < 12) return 'Bom dia';
  if (h < 18) return 'Boa tarde';
  return 'Boa noite';
}

// ─────────────────────────────────────────────────────────────────────────────
// Nome do contato
// ─────────────────────────────────────────────────────────────────────────────

const PARTICULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);

/**
 * Extrai o primeiro nome utilizável de um nome de planilha.
 *
 * Planilha de campanha vem cheia de "JOSE DA SILVA", "maria   souza",
 * "SR. ANTONIO", "-", "SEM NOME". Mandar "Bom dia, JOSE DA SILVA!" denuncia
 * na hora que a mensagem saiu de uma lista, que é exatamente o que não pode
 * parecer. Devolve `null` quando não dá para usar — aí a mensagem é montada
 * sem o nome, em vez de sair quebrada.
 */
export function primeiroNomeDe(nome: string | null | undefined): string | null {
  if (!nome) return null;

  const limpo = nome
    .replace(/[^\p{L}\p{M}\s'-]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!limpo) return null;

  const descartaveis = new Set(['sr', 'sra', 'srta', 'dr', 'dra', 'sem', 'nome', 'null', 'na']);

  for (const parte of limpo.split(' ')) {
    const base = parte.toLocaleLowerCase('pt-BR');
    if (base.length < 2) continue;
    if (PARTICULAS.has(base) || descartaveis.has(base)) continue;
    // Title case, preservando hífen e apóstrofo: "d'avila" → "D'Avila"
    return base.replace(/(^|[-'])(\p{L})/gu, (_, sep: string, letra: string) =>
      sep + letra.toLocaleUpperCase('pt-BR'),
    );
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// A chapa
// ─────────────────────────────────────────────────────────────────────────────

const ROTULO_CARGO: Record<string, string> = {
  presidente: 'presidente',
  governador: 'governador',
  senador: 'senador',
  deputado_federal: 'deputado federal',
  deputado_estadual: 'deputado estadual',
  deputado_distrital: 'deputado distrital',
};

/**
 * Lista a chapa em português corrido: "Fulano (deputado federal), Beltrana
 * (governadora) e Sicrano (senador)".
 *
 * Sem artigo antes do nome de propósito — o sistema não guarda o gênero de
 * cada candidatura, e errar "o/a" numa mensagem de campanha pega muito mal.
 *
 * É esta lista que faz o consentimento ser específico: a pessoa autoriza
 * sabendo exatamente de quem vai receber material. Ver a nota em
 * `validarModelo`.
 */
export function listarChapa(chapa: readonly CandidatoNaChapa[]): string {
  const partes = chapa.map((c) => {
    const cargo = ROTULO_CARGO[c.cargo] ?? c.cargo;
    return `${c.nome} (${cargo})`;
  });
  if (partes.length === 0) return '';
  if (partes.length === 1) return partes[0];
  return `${partes.slice(0, -1).join(', ')} e ${partes[partes.length - 1]}`;
}

/** Os materiais do candidato, um por linha, com o nome de cada peça. */
export function listarMateriais(materiais: readonly MaterialComLink[]): string {
  return materiais.map((m) => `${m.titulo}: ${m.url}`).join('\n');
}

// ─────────────────────────────────────────────────────────────────────────────
// Substituição
// ─────────────────────────────────────────────────────────────────────────────

const PADRAO_VARIAVEL = /\{\{\s*([a-z_]+)\s*\}\}/g;

/** Todas as variáveis usadas por um texto de modelo, na ordem de aparição. */
export function variaveisUsadas(template: string): string[] {
  return [...template.matchAll(PADRAO_VARIAVEL)].map((m) => m[1]);
}

/**
 * Limpa o rastro que uma variável vazia deixa na pontuação.
 * Sem isto, um contato sem nome recebe "Bom dia, ! Tudo bem?".
 */
function limparPontuacao(texto: string): string {
  return texto
    .replace(/[ \t]+/g, ' ')
    .replace(/\s+([,;:!?.])/g, '$1')
    .replace(/([,;:])\s*([,;:!?.])/g, '$2')
    .replace(/([,;:])\s*$/gm, '')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Substitui as variáveis do modelo pelos valores do contexto. */
export function montarTexto(template: string, ctx: ContextoMensagem): string {
  const materiais = ctx.materiais ?? [];
  const valores: Record<string, string> = {
    saudacao: saudacao(ctx.agora, ctx.timezone),
    primeiro_nome: ctx.primeiroNome ?? '',
    nome: ctx.nomeAtendente,
    candidatos: listarChapa(ctx.chapa ?? []),
    origem: FRASE_ORIGEM[ctx.origemContato ?? 'lista_fria'],
    candidato: ctx.candidato ?? '',
    cargo: ctx.cargo ? (ROTULO_CARGO[ctx.cargo] ?? ctx.cargo) : '',
    numero: ctx.numero ?? '',
    partido: ctx.partido ?? '',
    cnpj: ctx.cnpj ?? '',
    link: ctx.link ?? materiais[0]?.url ?? '',
    materiais: listarMateriais(materiais),
    link_grupo: ctx.linkGrupo ?? '',
    municipio: ctx.municipio ?? '',
  };

  const substituido = template.replace(PADRAO_VARIAVEL, (inteiro, chave: string) =>
    chave in valores ? valores[chave] : inteiro,
  );

  return limparPontuacao(substituido);
}

// ─────────────────────────────────────────────────────────────────────────────
// Blocos travados — validação do editor do gestor
// ─────────────────────────────────────────────────────────────────────────────

export type CodigoProblema =
  | 'variavel_desconhecida'
  | 'falta_chapa'
  | 'falta_candidato_cargo'
  | 'candidato_cargo_separados'
  | 'falta_numero'
  | 'falta_origem'
  | 'falta_frase_parar'
  | 'falta_link'
  | 'falta_cnpj'
  | 'link_na_permissao'
  | 'emoji_na_permissao'
  | 'candidato_na_abertura'
  | 'linhas_demais'
  | 'vazio';

/**
 * Quanto pesa um problema apontado no texto.
 *
 * ⚠️ Até esta versão havia só um booleano de "impede salvar", e quase tudo o
 * marcava: o gestor não conseguia gravar um texto que não passasse por todas as
 * regras. A intenção era boa e o efeito, não — mensagem de campanha precisa
 * soar de gente, e regra que impede salvar empurra todo mundo para o mesmo
 * texto engessado.
 *
 * Agora o editor APONTA e o gestor DECIDE. Só continua impedindo o que não é
 * escolha de escrita, e sim texto que sai quebrado na mão da pessoa.
 *
 *   `impede` — o texto não funcionaria. Vazio, ou variável que não existe (ela
 *              sairia crua, "Oi {{primero_nome}}", no WhatsApp de um eleitor).
 *   `risco`  — sai funcionando, mas custa caro: é a defesa jurídica da campanha
 *              ou a saúde do número. Aparece em vermelho e não trava.
 *   `aviso`  — orientação de ofício. Âmbar.
 */
export type NivelProblema = 'impede' | 'risco' | 'aviso';

export type Problema = {
  codigo: CodigoProblema;
  nivel: NivelProblema;
  mensagem: string;
};

const MAX_LINHAS = 4;

/** Frase que oferece parar e apagar — é o direito de saída, e não é opcional. */
const RE_PARAR =
  /apago|apagar|apagado|paro por aqui|não te chamo mais|nao te chamo mais|tiro seu (número|numero|contato)|tirar (seu|o) (número|numero|contato)|não receber|nao receber|sair da lista/i;

const RE_EMOJI = /\p{Extended_Pictographic}/u;
const RE_URL = /https?:\/\/|www\./i;

/** Divide em frases, para checar o que precisa estar na MESMA frase. */
function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Valida um texto de modelo antes de o gestor salvar.
 *
 * ── Por que a Permissão exige {{candidatos}} ──────────────────────────────
 *
 * O atendente atende vários candidatos ao mesmo tempo. Se a primeira mensagem
 * citasse só um e a pessoa recebesse material de mais quatro, o que ela
 * autorizou não cobriria o que ela recebeu — a LGPD pede consentimento
 * ESPECÍFICO e informado. Declarar a chapa inteira de saída é o que torna o
 * "pode" dela válido para tudo que vem depois.
 *
 * É também o que sustenta a trava do banco: os candidatos declarados são
 * congelados em `contato_candidato` no momento do envio, e material de
 * candidato não declarado é recusado (ver 20260823220100).
 *
 * ── Por que o Material precisa se identificar sozinho ─────────────────────
 *
 * Cada peça chega separada, possivelmente dias depois. Ela precisa dizer de
 * quem é: nome, cargo e número. Sem isso a pessoa recebe um link solto e não
 * consegue nem saber a quem ele se refere.
 *
 * ⚠️ O aviso de CNPJ é AVISO, não trava. Se a mensagem de WhatsApp conta como
 * material de propaganda para efeito de identificação obrigatória é pergunta
 * para o advogado eleitoral — não sei, e não vou travar o trabalho do gestor
 * com base num palpite meu. O aviso existe para a pergunta ser feita.
 *
 * ── E por que nada disso IMPEDE mais de salvar ────────────────────────────
 *
 * Porque tudo que está escrito acima explica um RISCO, e quem decide correr um
 * risco da campanha é quem responde por ela. As regras continuam aqui, com o
 * mesmo texto e a mesma cor de urgência — o que mudou é que elas informam em
 * vez de trancar. Ver `NivelProblema`.
 */
export function validarModelo(etapa: Etapa, texto: string): Problema[] {
  const problemas: Problema[] = [];
  const t = (texto ?? '').trim();

  if (!t) {
    return [{ codigo: 'vazio', nivel: 'impede', mensagem: 'O texto não pode ficar vazio.' }];
  }

  for (const v of variaveisUsadas(t)) {
    if (!(VARIAVEIS_CONHECIDAS as readonly string[]).includes(v)) {
      problemas.push({
        codigo: 'variavel_desconhecida',
        // Único caso que continua impedindo, junto com o vazio: não é escolha
        // de escrita. Uma variável que não existe sai CRUA no WhatsApp da
        // pessoa — "Oi {{primero_nome}}" — e é o tipo de erro que só aparece
        // depois de a mensagem ter sido enviada.
        nivel: 'impede',
        mensagem: `A variável {{${v}}} não existe. Disponíveis: ${VARIAVEIS_CONHECIDAS.map((x) => `{{${x}}}`).join(', ')}.`,
      });
    }
  }

  /**
   * ── Abertura ──────────────────────────────────────────────────────────────
   *
   * É a mensagem que chega sem aviso, para quem não espera. Ela não pede nada,
   * não anuncia nada e não leva link: é um "oi" e a espera da resposta. As
   * regras dela são as duas que descrevem justamente isso.
   *
   * Não exige {{candidatos}} nem {{origem}}: quem declara a chapa e diz de onde
   * veio o contato é a Permissão, e é lá que o consentimento é congelado. Pedir
   * isso já no "oi" devolveria o panfleto que os quatro passos vieram desfazer.
   */
  if (etapa === 'abertura') {
    if (t.includes('{{link}}') || t.includes('{{materiais}}') || t.includes('{{link_grupo}}') || RE_URL.test(t)) {
      problemas.push({
        codigo: 'link_na_permissao',
        nivel: 'risco',
        mensagem: 'A abertura não pode ter link. Ela é só o "oi" — link só depois do "pode".',
      });
    }
    if (RE_EMOJI.test(t)) {
      problemas.push({
        codigo: 'emoji_na_permissao',
        nivel: 'risco',
        mensagem: 'Sem emoji na abertura — é o padrão que mais parece disparo na primeira mensagem.',
      });
    }
    if (t.includes('{{candidatos}}') || t.includes('{{candidato}}')) {
      problemas.push({
        codigo: 'candidato_na_abertura',
        nivel: 'risco',
        mensagem:
          'A abertura cita candidato. Ela existe para ser só um "oi": emendar o assunto na ' +
          'primeira mensagem é o que faz a conversa parecer panfleto. Quem conta a escolha é o ' +
          'passo seguinte.',
      });
    }
  }

  /**
   * ── Minha escolha ─────────────────────────────────────────────────────────
   *
   * O coração do roteiro, e a única parte em que a mensagem é do ATENDENTE, na
   * primeira pessoa. Só não pode levar link: o link vem depois do "pode".
   */
  if (etapa === 'minha_escolha') {
    if (t.includes('{{link}}') || t.includes('{{materiais}}') || t.includes('{{link_grupo}}') || RE_URL.test(t)) {
      problemas.push({
        codigo: 'link_na_permissao',
        nivel: 'risco',
        mensagem: 'Ainda não. O link só sai depois de a pessoa autorizar, no passo seguinte.',
      });
    }
    if (!t.includes('{{candidatos}}') && !t.includes('{{candidato}}')) {
      problemas.push({
        codigo: 'falta_chapa',
        nivel: 'aviso',
        mensagem:
          'Esta é a mensagem que conta a escolha, e ela não nomeia ninguém. Use {{candidatos}} — ' +
          'sem isso o passo seguinte pede permissão para algo que a pessoa não sabe o que é.',
      });
    }
  }

  const exigeSaida = etapa === 'permissao' || etapa === 'material';
  if (exigeSaida && !RE_PARAR.test(t)) {
    problemas.push({
      codigo: 'falta_frase_parar',
      nivel: 'risco',
      mensagem: 'Falta oferecer parar e apagar o contato (ex.: "se não quiser, me fala que apago seu número").',
    });
  }

  if (etapa === 'permissao') {
    if (!t.includes('{{candidatos}}')) {
      problemas.push({
        codigo: 'falta_chapa',
        nivel: 'risco',
        mensagem:
          'A Permissão precisa usar {{candidatos}}, que declara TODOS os candidatos que você atende. ' +
          'A pessoa tem que autorizar sabendo de quem vai receber material — é isso que torna o "pode" dela válido.',
      });
    }
    if (!t.includes('{{origem}}')) {
      problemas.push({
        codigo: 'falta_origem',
        nivel: 'risco',
        mensagem:
          'A Permissão precisa usar {{origem}}, que explica como você chegou no contato. ' +
          'É variável e não frase escrita porque a resposta muda: quem veio da lista foi indicado ' +
          'por um apoiador, quem veio do site pediu o material sozinho. Escrever à mão faria a ' +
          'mesma frase sair para os dois — e para um deles seria mentira.',
      });
    }
    if (t.includes('{{link}}') || t.includes('{{materiais}}') || t.includes('{{link_grupo}}') || RE_URL.test(t)) {
      problemas.push({
        codigo: 'link_na_permissao',
        nivel: 'risco',
        mensagem: 'A primeira mensagem não pode ter link. Link só depois do "pode".',
      });
    }
    if (RE_EMOJI.test(t)) {
      problemas.push({
        codigo: 'emoji_na_permissao',
        nivel: 'risco',
        mensagem: 'Sem emoji na primeira mensagem — é o padrão que mais parece disparo.',
      });
    }
  }

  if (etapa === 'material') {
    const temCandidato = t.includes('{{candidato}}');
    const temCargo = t.includes('{{cargo}}');

    if (!temCandidato || !temCargo) {
      problemas.push({
        codigo: 'falta_candidato_cargo',
        nivel: 'risco',
        mensagem:
          'O Material precisa dizer de quem ele é: use {{candidato}} e {{cargo}}. ' +
          'Cada peça chega separada e tem que se identificar sozinha.',
      });
    } else if (!frases(t).some((f) => f.includes('{{candidato}}') && f.includes('{{cargo}}'))) {
      problemas.push({
        codigo: 'candidato_cargo_separados',
        nivel: 'risco',
        mensagem: '{{candidato}} e {{cargo}} precisam aparecer na MESMA frase, para não parecer propaganda solta.',
      });
    }

    if (!t.includes('{{numero}}')) {
      problemas.push({
        codigo: 'falta_numero',
        nivel: 'risco',
        mensagem: 'Falta {{numero}} — é o número de urna, e sem ele o material não serve para votar.',
      });
    }

    if (!t.includes('{{link}}') && !t.includes('{{materiais}}')) {
      problemas.push({
        codigo: 'falta_link',
        nivel: 'risco',
        mensagem:
          'O Material precisa de {{materiais}} (todas as peças do candidato) ou {{link}} (só a primeira). ' +
          'É do link rastreado que sai a única métrica confiável do projeto.',
      });
    }

    if (!t.includes('{{cnpj}}')) {
      problemas.push({
        codigo: 'falta_cnpj',
        nivel: 'aviso',
        mensagem:
          'Sem {{cnpj}}. Material de propaganda eleitoral costuma precisar do CNPJ da campanha para ' +
          'ser identificável. Se a mensagem de WhatsApp conta como material para esse efeito é pergunta ' +
          'para o advogado eleitoral — vale confirmar antes de a operação começar.',
      });
    }
  }

  const linhas = t.split('\n').filter((l) => l.trim()).length;
  if (linhas > MAX_LINHAS) {
    problemas.push({
      codigo: 'linhas_demais',
      nivel: 'aviso',
      mensagem: `Mensagem com ${linhas} linhas. O combinado é no máximo ${MAX_LINHAS} — texto longo parece panfleto.`,
    });
  }

  return problemas;
}

/**
 * `true` quando o gestor pode salvar o modelo.
 *
 * Hoje isso é quase sempre. Só texto que sairia quebrado na mão da pessoa
 * impede — o resto é apontado na tela e decidido por quem responde pela
 * campanha. Ver `NivelProblema`.
 */
export function podeSalvar(problemas: Problema[]): boolean {
  return !problemas.some((p) => p.nivel === 'impede');
}

/** Os que o editor pinta de vermelho: impedimento ou risco assumido. */
export function ehGrave(p: Problema): boolean {
  return p.nivel !== 'aviso';
}

// ─────────────────────────────────────────────────────────────────────────────
// Rotação de variação por chip
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Escolhe a próxima variação de um modelo para um chip.
 *
 * O antispam do WhatsApp olha o NÚMERO, não o atendente: o mesmo chip mandando
 * texto idêntico em sequência é o padrão clássico de disparo. A rotação é por
 * chip justamente por isso (docs/02-CONSTRUCAO-TECNICA.md §8).
 *
 * Avança circularmente a partir da última usada, o que nunca repete a anterior
 * — exceto quando só existe uma variação cadastrada, caso em que não há escolha.
 */
export function proximaVariacao<T extends { id: string }>(
  variacoes: readonly T[],
  ultimaVariacaoId: string | null | undefined,
): T {
  if (variacoes.length === 0) {
    throw new Error('Modelo sem nenhuma variação cadastrada.');
  }
  const i = variacoes.findIndex((v) => v.id === ultimaVariacaoId);
  return i === -1 ? variacoes[0] : variacoes[(i + 1) % variacoes.length];
}
