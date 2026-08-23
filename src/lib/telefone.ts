/**
 * Normalização e deduplicação de telefone brasileiro.
 *
 * ⚠️ FUNÇÃO CRÍTICA — não alterar sem rodar `npm test`.
 *
 * Se esta função errar, dois atendentes falam com a mesma pessoa (o mesmo número
 * chega em formatos diferentes na planilha) — o que, numa campanha eleitoral,
 * vira denúncia. Ver docs/02-CONSTRUCAO-TECNICA.md §5.1.
 *
 * CONCEITOS
 * ---------
 * `e164`       forma canônica usada para abrir a conversa no WhatsApp.
 *              SÓ DÍGITOS, sem '+': "5569981234567" (55 + DDD + 9 + 8 dígitos).
 *              É o que a URL web.whatsapp.com/send?phone= espera.
 *
 * `chaveDedup` chave de deduplicação: DDD + os 8 dígitos finais, SEM o nono dígito.
 *              O mesmo número escrito com ou sem o 9 produz A MESMA chave, então
 *              um UNIQUE INDEX no banco resolve o dedup — não dependemos de o
 *              código da aplicação lembrar de checar as duas formas.
 *
 *              "+55 69 98123-4567" ─┐
 *              "(69) 8123-4567"     ├─→ chaveDedup "6981234567"
 *              "5569981234567"     ─┘
 */

/**
 * Os 67 DDDs em uso no Brasil (Anatel). Fora desta lista o número não existe —
 * é erro de digitação ou lixo de planilha.
 */
export const DDDS_VALIDOS: ReadonlySet<string> = new Set([
  // SP
  '11', '12', '13', '14', '15', '16', '17', '18', '19',
  // RJ / ES
  '21', '22', '24', '27', '28',
  // MG
  '31', '32', '33', '34', '35', '37', '38',
  // PR / SC
  '41', '42', '43', '44', '45', '46', '47', '48', '49',
  // RS
  '51', '53', '54', '55',
  // Centro-Oeste / Norte
  '61', '62', '63', '64', '65', '66', '67', '68', '69',
  // BA / SE
  '71', '73', '74', '75', '77', '79',
  // Nordeste
  '81', '82', '83', '84', '85', '86', '87', '88', '89',
  // Norte / MA
  '91', '92', '93', '94', '95', '96', '97', '98', '99',
]);

export type MotivoInvalido =
  /** campo vazio ou sem nenhum dígito */
  | 'vazio'
  /** menos de 10 dígitos depois de limpar DDI e prefixo de discagem */
  | 'curto'
  /** mais de 11 dígitos — provavelmente número estrangeiro ou dois números na mesma célula */
  | 'longo'
  /** DDD fora dos 67 em uso */
  | 'ddd_invalido'
  /** telefone FIXO (local com 8 dígitos começando em 2–5). Não tem WhatsApp na operação. */
  | 'fixo'
  /** prefixo local impossível (começa em 0 ou 1) */
  | 'formato';

export type TelefoneValido = {
  valido: true;
  /** só dígitos, com DDI: "5569981234567" */
  e164: string;
  /** DDD + 8 dígitos finais: "6981234567" */
  chaveDedup: string;
  ddd: string;
};

export type TelefoneInvalido = {
  valido: false;
  motivo: MotivoInvalido;
  e164: null;
  chaveDedup: null;
  /** preenchido quando deu para extrair, ajuda o gestor a entender a rejeição */
  ddd: string | null;
};

export type TelefoneNormalizado = TelefoneValido | TelefoneInvalido;

function invalido(motivo: MotivoInvalido, ddd: string | null = null): TelefoneInvalido {
  return { valido: false, motivo, e164: null, chaveDedup: null, ddd };
}

/**
 * Reduz o que veio da planilha a 10 ou 11 dígitos (DDD + local).
 *
 * Trata, nesta ordem:
 *   - lixo não numérico: "(69) 9 8123-4567", "69 98123 4567 / recado"
 *   - zero de tronco:    "069981234567", "0 69 98123-4567"
 *   - DDI 55:            "5569981234567", "+55 (69) 98123-4567"
 *   - DDI 55 duplicado:  "555569981234567" (acontece em merge de planilha)
 *
 * O corte do "55" só acontece quando sobram MAIS de 11 dígitos. Isso preserva
 * o DDD 55 (Santa Maria/RS): "55999887766" tem 11 dígitos e é DDD 55 + celular,
 * não DDI 55 + número de 9 dígitos.
 */
function reduzir(digitos: string): string {
  let d = digitos.replace(/^0+/, ''); // 0 nunca inicia DDD: é prefixo de discagem
  while (d.length > 11 && d.startsWith('55')) {
    d = d.slice(2);
  }
  return d;
}

/**
 * Normaliza um telefone vindo de planilha, formulário ou digitação.
 * Nunca lança — devolve o motivo da rejeição para a tela de conferência do gestor.
 */
export function normalizarTelefone(bruto: string | number | null | undefined): TelefoneNormalizado {
  if (bruto === null || bruto === undefined) return invalido('vazio');

  const digitos = String(bruto).replace(/\D/g, '');
  if (digitos.length === 0) return invalido('vazio');

  const d = reduzir(digitos);

  if (d.length < 10) return invalido('curto');
  if (d.length > 11) return invalido('longo');

  const ddd = d.slice(0, 2);
  if (!DDDS_VALIDOS.has(ddd)) return invalido('ddd_invalido', ddd);

  const local = d.slice(2);

  // ── 11 dígitos: celular no formato atual (DDD + 9 + 8 dígitos) ──────────────
  if (local.length === 9) {
    if (local[0] !== '9') {
      // local de 9 dígitos que não começa com 9 não é celular brasileiro
      return invalido('formato', ddd);
    }
    return {
      valido: true,
      ddd,
      e164: `55${ddd}${local}`,
      chaveDedup: `${ddd}${local.slice(1)}`,
    };
  }

  // ── 10 dígitos: DDD + 8 dígitos. Aqui mora a pegadinha. ────────────────────
  // O documento original manda adicionar o 9 sempre que houver 10 dígitos.
  // Isso está ERRADO: transforma o fixo (69) 3221-4567 no celular inexistente
  // (69) 93221-4567, que entraria na fila e queimaria uma conversa.
  // O primeiro dígito local decide:
  //   2–5 → telefone FIXO      → rejeitar
  //   6–9 → celular pré-2016   → prefixar o nono dígito
  //   0–1 → prefixo impossível → rejeitar
  const prefixo = local[0];

  if (prefixo >= '2' && prefixo <= '5') return invalido('fixo', ddd);
  if (prefixo < '6') return invalido('formato', ddd);

  return {
    valido: true,
    ddd,
    e164: `55${ddd}9${local}`,
    chaveDedup: `${ddd}${local}`,
  };
}

/** "5569981234567" → "(69) 98123-4567". Para exibir na tela do atendente. */
export function formatarExibicao(e164: string): string {
  const d = e164.replace(/\D/g, '').replace(/^55/, '');
  if (d.length === 11) return `(${d.slice(0, 2)}) ${d.slice(2, 7)}-${d.slice(7)}`;
  if (d.length === 10) return `(${d.slice(0, 2)}) ${d.slice(2, 6)}-${d.slice(6)}`;
  return e164;
}

/**
 * Monta a URL que abre a conversa no WhatsApp Web já logado, com o texto pronto.
 *
 * ⚠️ Esta é a ÚNICA forma de envio do sistema, e ela é MANUAL: abre o chat com o
 * texto preenchido e para aí. Quem revisa e aperta enviar é o atendente.
 * Não introduzir Baileys, Evolution, Puppeteer ou qualquer envio automático.
 * Ver docs/01-VISAO-GERAL.md §2.
 */
export function urlWhatsApp(e164: string, texto: string): string {
  const phone = e164.replace(/\D/g, '');
  return `https://web.whatsapp.com/send?phone=${phone}&text=${encodeURIComponent(texto)}`;
}
