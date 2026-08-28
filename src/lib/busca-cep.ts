import 'server-only';
import { normalizarCep } from './cep';
import { coordenadaPlausivel } from './distancia';

/**
 * Consulta de endereço por CEP (ViaCEP).
 *
 * ⚠️ Roda no SERVIDOR, nunca no navegador — e isso é a razão de o arquivo
 * existir em vez de um `fetch` direto no componente:
 *
 * 1. O eleitor não fala com terceiro. Se o navegador dele consultasse o ViaCEP,
 *    o IP e o CEP dele iriam para outra empresa em toda tecla. Aqui quem
 *    pergunta é o nosso servidor, e o serviço externo só vê a Vercel.
 * 2. Dá para guardar a resposta. CEP praticamente não muda; com `revalidate` de
 *    30 dias, a segunda pessoa da mesma rua não gera consulta nenhuma.
 * 3. Serviço externo cai. Com tempo-limite curto, o formulário continua
 *    preenchível na mão — nunca fica preso esperando.
 *
 * O CEP não é dado pessoal sozinho (é a rua, não a casa), então mandá-lo ao
 * serviço não fere a regra de nunca colocar dado pessoal em URL: nome, telefone
 * e número da casa não saem daqui.
 */

const RAIZ = 'https://viacep.com.br/ws';

/** Curto de propósito: formulário travado converte pior que campo vazio. */
const TEMPO_LIMITE_MS = 4000;

/** CEP muda pouco; guardar 30 dias corta quase toda consulta repetida. */
const VALIDADE_S = 60 * 60 * 24 * 30;

/** Quantos resultados a busca por rua devolve. Acima disso ninguém lê. */
const MAX_RESULTADOS = 12;

export type EnderecoDoCep = {
  /** 8 dígitos, sem hífen. */
  cep: string;
  rua: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
};

export type MotivoCep =
  /** não são 8 dígitos */
  | 'invalido'
  /** o CEP não existe */
  | 'nao_encontrado'
  /** o ViaCEP não respondeu, respondeu erro ou estourou o tempo */
  | 'servico_fora';

export type ResultadoCep =
  | { ok: true; endereco: EnderecoDoCep }
  | { ok: false; motivo: MotivoCep };

export type ResultadoBuscaRua =
  | { ok: true; achados: EnderecoDoCep[] }
  | { ok: false; motivo: 'termo_curto' | 'nao_encontrado' | 'servico_fora' };

/** Um endereço a partir do CEP. É o caminho normal. */
export async function consultarCep(bruto: string): Promise<ResultadoCep> {
  const cep = normalizarCep(bruto);
  if (!cep) return { ok: false, motivo: 'invalido' };

  const resposta = await pedir(`${RAIZ}/${cep}/json/`);
  if (resposta === null) return { ok: false, motivo: 'servico_fora' };

  // O ViaCEP responde 200 com `{"erro": "true"}` para CEP inexistente — já veio
  // como booleano e como string ao longo do tempo, então os dois são tratados.
  if (resposta.erro === true || resposta.erro === 'true') {
    return { ok: false, motivo: 'nao_encontrado' };
  }

  return { ok: true, endereco: converter(resposta, cep) };
}

/**
 * Endereços a partir do nome da rua, dentro da cidade que a pessoa escolheu.
 *
 * É a saída para quem não sabe o próprio CEP — que em Rondônia é comum, e
 * também é o caso das cidades pequenas, onde o CEP é um só para o município
 * inteiro e não devolve nem rua nem bairro.
 */
export async function buscarPorRua(
  uf: string, cidade: string, rua: string,
): Promise<ResultadoBuscaRua> {
  const termo = rua.trim();
  // O ViaCEP exige 3 caracteres; abaixo disso ele recusa e nós evitamos a ida.
  if (termo.length < 3 || cidade.trim().length < 3 || uf.trim().length !== 2) {
    return { ok: false, motivo: 'termo_curto' };
  }

  const caminho = [uf, cidade, termo].map((p) => encodeURIComponent(p.trim())).join('/');
  const resposta = await pedir(`${RAIZ}/${caminho}/json/`);
  if (resposta === null) return { ok: false, motivo: 'servico_fora' };
  if (!Array.isArray(resposta)) return { ok: false, motivo: 'nao_encontrado' };
  if (resposta.length === 0) return { ok: false, motivo: 'nao_encontrado' };

  const achados = resposta
    .slice(0, MAX_RESULTADOS)
    .map((r) => converter(r, normalizarCep(r?.cep) ?? ''))
    .filter((e) => e.cep.length === 8);

  return achados.length > 0
    ? { ok: true, achados }
    : { ok: false, motivo: 'nao_encontrado' };
}

/* ── Internos ──────────────────────────────────────────────────────────── */

/** Devolve o JSON, ou null para qualquer forma de "não deu". */
async function pedir(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url, {
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      next: { revalidate: VALIDADE_S },
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    // Tempo esgotado, DNS, TLS, JSON quebrado — para a tela é tudo a mesma
    // coisa: "não consegui buscar, escreva na mão".
    return null;
  }
}

function converter(bruto: Record<string, unknown> | unknown, cep: string): EnderecoDoCep {
  const d = (bruto ?? {}) as Record<string, unknown>;
  return {
    cep,
    rua: texto(d.logradouro),
    bairro: texto(d.bairro),
    cidade: texto(d.localidade),
    uf: texto(d.uf),
  };
}

/** Vazio do ViaCEP vem como "" — vira null para a tela não achar que preencheu. */
function texto(v: unknown): string | null {
  const s = typeof v === 'string' ? v.trim() : '';
  return s.length > 0 ? s : null;
}

/* ── Coordenada do CEP ─────────────────────────────────────────────────────
 *
 * O ViaCEP não devolve latitude e longitude, e a tela de comitês precisa delas
 * para dizer "há um comitê a X km de você". A BrasilAPI devolve, é gratuita e
 * NÃO EXIGE CHAVE — nada para cadastrar, nada para expirar no meio da campanha.
 *
 * Mesmo desenho e mesmos motivos do resto deste arquivo: roda no servidor (o
 * eleitor não fala com terceiro), guarda a resposta por 30 dias, e tem
 * tempo-limite curto porque serviço externo cai.
 *
 * ⚠️ FALHA COM FREQUÊNCIA, e isso é previsto. Em cidade pequena de Rondônia o
 * CEP é um só para o município inteiro e a BrasilAPI devolve erro. Quem chama
 * precisa saber viver sem a coordenada: a tela cai para "temos um comitê na sua
 * cidade", sem número. Distância errada é pior que distância nenhuma.
 */

const RAIZ_BRASILAPI = 'https://brasilapi.com.br/api/cep/v2';

export type Coordenada = { lat: number; lon: number };

export async function coordenadaDoCep(bruto: string): Promise<Coordenada | null> {
  const cep = normalizarCep(bruto);
  if (!cep) return null;

  try {
    const r = await fetch(`${RAIZ_BRASILAPI}/${cep}`, {
      signal: AbortSignal.timeout(TEMPO_LIMITE_MS),
      next: { revalidate: VALIDADE_S },
      headers: { accept: 'application/json' },
    });
    if (!r.ok) return null;

    const d = await r.json() as {
      location?: { coordinates?: { latitude?: string; longitude?: string } };
    };
    const c = d?.location?.coordinates;
    if (!c) return null;

    // Vêm como TEXTO na resposta ("-8.76194"), não como número.
    const lat = Number(c.latitude);
    const lon = Number(c.longitude);
    const ponto = { lat, lon };

    // A mesma conferência que o cadastro do comitê faz: um par implausível
    // viraria uma distância de milhares de quilômetros mostrada com toda a
    // seriedade.
    return coordenadaPlausivel(ponto) ? ponto : null;
  } catch {
    // Tempo esgotado, DNS, TLS, JSON quebrado, CEP de município inteiro — para
    // quem chama é tudo a mesma coisa: "não sei onde é".
    return null;
  }
}
