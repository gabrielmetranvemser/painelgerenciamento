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
  | 'permissao'
  | 'material'
  | 'saida'
  | 'quem_passou'
  | 'quer_ajudar'
  | 'encaminhamento'
  | 'convite_grupo';

export const VARIAVEIS_CONHECIDAS = [
  'saudacao',
  'primeiro_nome',
  'nome',
  'candidato',
  'cargo',
  'numero',
  'link',
  'link_grupo',
  'municipio',
] as const;

export type Variavel = (typeof VARIAVEIS_CONHECIDAS)[number];

export type ContextoMensagem = {
  /** primeiro nome do contato, já tratado por `primeiroNomeDe` */
  primeiroNome: string | null;
  /** primeiro nome do ATENDENTE — a mensagem é assinada por ele, não pela campanha */
  nomeAtendente: string;
  candidato: string;
  cargo: string;
  numero: string;
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
  const valores: Record<string, string> = {
    saudacao: saudacao(ctx.agora, ctx.timezone),
    primeiro_nome: ctx.primeiroNome ?? '',
    nome: ctx.nomeAtendente,
    candidato: ctx.candidato,
    cargo: ctx.cargo,
    numero: ctx.numero,
    link: ctx.link ?? '',
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
  | 'falta_candidato_cargo'
  | 'candidato_cargo_separados'
  | 'falta_mencao_apoiador'
  | 'falta_frase_parar'
  | 'falta_link'
  | 'link_na_permissao'
  | 'emoji_na_permissao'
  | 'linhas_demais'
  | 'vazio';

export type Problema = {
  codigo: CodigoProblema;
  /** `true` impede salvar; `false` é só aviso na tela */
  bloqueia: boolean;
  mensagem: string;
};

const MAX_LINHAS = 4;

/** Menção de que o contato veio de um apoiador — é a justificativa de como temos o número. */
const RE_APOIADOR = /apoiador|apoiadora|apoiante|indicou|me passou seu contato|me indicou/i;

/** Frase que oferece parar e apagar — é o direito de saída, e ela não é opcional. */
const RE_PARAR =
  /apago|apagar|apagado|paro por aqui|não te chamo mais|nao te chamo mais|tiro seu (número|numero|contato)|tirar (seu|o) (número|numero|contato)|não receber|nao receber|sair da lista/i;

const RE_EMOJI = /\p{Extended_Pictographic}/u;
const RE_URL = /https?:\/\/|www\./i;

/** Divide em frases para checar se candidato e cargo estão na MESMA frase. */
function frases(texto: string): string[] {
  return texto
    .split(/(?<=[.!?])\s+|\n+/)
    .map((f) => f.trim())
    .filter(Boolean);
}

/**
 * Valida um texto de modelo antes de o gestor salvar.
 *
 * As travas da Permissão e do Material vêm de docs/02-CONSTRUCAO-TECNICA.md §8
 * e docs/03-OPERACAO.md §8.
 *
 * Nota sobre a menção ao apoiador: o documento diz que ela é obrigatória na
 * Permissão e no Material, mas o texto de Material que o próprio documento
 * fornece não a contém — o Material já vai para quem autorizou, e a origem do
 * contato foi explicada na Permissão. Exigimos na Permissão (que é onde ela
 * cumpre a função) e avisamos sem bloquear no Material.
 */
export function validarModelo(etapa: Etapa, texto: string): Problema[] {
  const problemas: Problema[] = [];
  const t = (texto ?? '').trim();

  if (!t) {
    return [{ codigo: 'vazio', bloqueia: true, mensagem: 'O texto não pode ficar vazio.' }];
  }

  for (const v of variaveisUsadas(t)) {
    if (!(VARIAVEIS_CONHECIDAS as readonly string[]).includes(v)) {
      problemas.push({
        codigo: 'variavel_desconhecida',
        bloqueia: true,
        mensagem: `A variável {{${v}}} não existe. Disponíveis: ${VARIAVEIS_CONHECIDAS.map((x) => `{{${x}}}`).join(', ')}.`,
      });
    }
  }

  const exigeCandidatoCargo = etapa === 'permissao' || etapa === 'material';

  if (exigeCandidatoCargo) {
    const temCandidato = t.includes('{{candidato}}');
    const temCargo = t.includes('{{cargo}}');

    if (!temCandidato || !temCargo) {
      problemas.push({
        codigo: 'falta_candidato_cargo',
        bloqueia: true,
        mensagem: 'A mensagem precisa dizer quem é o candidato e para qual cargo: use {{candidato}} e {{cargo}}.',
      });
    } else if (!frases(t).some((f) => f.includes('{{candidato}}') && f.includes('{{cargo}}'))) {
      problemas.push({
        codigo: 'candidato_cargo_separados',
        bloqueia: true,
        mensagem: '{{candidato}} e {{cargo}} precisam aparecer na MESMA frase, para não parecer propaganda solta.',
      });
    }

    if (!RE_PARAR.test(t)) {
      problemas.push({
        codigo: 'falta_frase_parar',
        bloqueia: true,
        mensagem: 'Falta oferecer parar e apagar o contato (ex.: "se não quiser, me fala que apago seu número").',
      });
    }
  }

  if (etapa === 'permissao') {
    if (!RE_APOIADOR.test(t)) {
      problemas.push({
        codigo: 'falta_mencao_apoiador',
        bloqueia: true,
        mensagem: 'A Permissão precisa explicar como você chegou no contato (ex.: "um apoiador me passou seu contato").',
      });
    }
    if (t.includes('{{link}}') || t.includes('{{link_grupo}}') || RE_URL.test(t)) {
      problemas.push({
        codigo: 'link_na_permissao',
        bloqueia: true,
        mensagem: 'A primeira mensagem não pode ter link. Link só depois do "pode".',
      });
    }
    if (RE_EMOJI.test(t)) {
      problemas.push({
        codigo: 'emoji_na_permissao',
        bloqueia: true,
        mensagem: 'Sem emoji na primeira mensagem — é o padrão que mais parece disparo.',
      });
    }
  }

  if (etapa === 'material') {
    if (!t.includes('{{link}}')) {
      problemas.push({
        codigo: 'falta_link',
        bloqueia: true,
        mensagem: 'O Material precisa conter {{link}} — é o link rastreado, e é dele que sai a métrica de clique.',
      });
    }
    if (!RE_APOIADOR.test(t)) {
      problemas.push({
        codigo: 'falta_mencao_apoiador',
        bloqueia: false,
        mensagem: 'O Material não repete de onde veio o contato. Costuma estar ok, já que a Permissão explicou.',
      });
    }
  }

  const linhas = t.split('\n').filter((l) => l.trim()).length;
  if (linhas > MAX_LINHAS) {
    problemas.push({
      codigo: 'linhas_demais',
      bloqueia: false,
      mensagem: `Mensagem com ${linhas} linhas. O combinado é no máximo ${MAX_LINHAS} — texto longo parece panfleto.`,
    });
  }

  return problemas;
}

/** `true` quando o gestor pode salvar o modelo. */
export function podeSalvar(problemas: Problema[]): boolean {
  return !problemas.some((p) => p.bloqueia);
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
