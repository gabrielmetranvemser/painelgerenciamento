/**
 * Preparação de uma lista importada.
 *
 * Roda no NAVEGADOR: uma planilha de 10 mil linhas normalizada no cliente evita
 * mandar o arquivo inteiro para o servidor e estourar o tempo da função
 * serverless. O servidor ainda revalida tudo que importa (bloqueio e unicidade
 * são garantidos no banco), então normalizar aqui é otimização, não confiança.
 */
import { normalizarTelefone, type MotivoInvalido } from './telefone';
import { primeiroNomeDe } from './mensagem';

export type MapaColunas = {
  nome: string | null;
  telefone: string;
  municipio: string | null;
};

export type LinhaPreparada = {
  nome: string | null;
  primeiroNome: string | null;
  e164: string;
  chaveDedup: string;
  municipioNome: string | null;
};

export type Analise = {
  totalLinhas: number;
  /** prontas para conferir contra o banco */
  validas: LinhaPreparada[];
  /** repetidas dentro do próprio arquivo */
  duplicadasNoArquivo: number;
  invalidas: number;
  /** quantas caíram em cada motivo, para o gestor entender a rejeição */
  porMotivo: Partial<Record<MotivoInvalido, number>>;
  /** primeiras rejeições, para mostrar exemplo na tela */
  exemplosRejeitados: { linha: number; valor: string; motivo: MotivoInvalido }[];
};

const MAX_EXEMPLOS = 8;

/** Nomes de coluna que costumam aparecer nas planilhas que chegam. */
const PISTAS = {
  telefone: ['telefone', 'celular', 'whatsapp', 'whats', 'fone', 'contato', 'numero', 'número', 'tel'],
  nome: ['nome', 'nome completo', 'eleitor', 'pessoa', 'cliente'],
  municipio: ['municipio', 'município', 'cidade', 'localidade'],
};

function semAcento(s: string) {
  // \u0300-\u036f é o bloco de acentos combinantes. Sem tirá-los, 'Ji-Paraná'
  // e 'Ji-Parana' viram cidades diferentes — e a planilha vem dos dois jeitos.
  return s.trim().toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * Chave de comparação de nome de cidade.
 *
 * Colapsa para só letras e números: acento, apóstrofo, hífen e espaço somem.
 * Num teste com 400 linhas reais, sem isto `ESPIGAO D OESTE` não casava com
 * `Espigão d'Oeste` e 8% do relatório por município caía em "(não informado)"
 * por causa de um apóstrofo.
 *
 * Colapsar assim só é seguro porque nenhum par de municípios de Rondônia
 * produz a mesma chave — e há um teste que verifica isso contra a lista inteira.
 * Se o sistema for usado em outro estado, rode esse teste com a nova lista.
 */
function chaveCidade(s: string) {
  return semAcento(s).replace(/[^a-z0-9]+/g, '');
}

/**
 * Chuta o mapeamento de colunas. O gestor confirma ou corrige na tela — nunca
 * importamos com base só no palpite.
 */
export function sugerirMapa(colunas: string[]): MapaColunas | { telefone: null } {
  const achar = (pistas: string[]) =>
    colunas.find((c) => {
      const n = semAcento(c);
      return pistas.some((p) => n === p) || pistas.some((p) => n.includes(p));
    }) ?? null;

  const telefone = achar(PISTAS.telefone);
  // Sem coluna de telefone não há o que importar: devolvemos null para a tela
  // pedir ao gestor que escolha a coluna na mão.
  if (!telefone) return { telefone: null };

  return { telefone, nome: achar(PISTAS.nome), municipio: achar(PISTAS.municipio) };
}

/**
 * Normaliza, valida e deduplica dentro do arquivo.
 *
 * O dedup aqui é só o primeiro filtro: o mesmo número em duas linhas da mesma
 * planilha. O dedup contra o que JÁ EXISTE no banco acontece no servidor, e a
 * garantia final é o UNIQUE INDEX — nenhuma das três camadas confia na anterior.
 */
export function analisarLinhas(
  linhas: Record<string, string>[],
  mapa: MapaColunas,
): Analise {
  const validas: LinhaPreparada[] = [];
  const vistas = new Set<string>();
  const porMotivo: Partial<Record<MotivoInvalido, number>> = {};
  const exemplosRejeitados: Analise['exemplosRejeitados'] = [];
  let duplicadasNoArquivo = 0;
  let invalidas = 0;

  linhas.forEach((linha, i) => {
    const bruto = (linha[mapa.telefone] ?? '').trim();
    const t = normalizarTelefone(bruto);

    if (!t.valido) {
      invalidas++;
      porMotivo[t.motivo] = (porMotivo[t.motivo] ?? 0) + 1;
      if (exemplosRejeitados.length < MAX_EXEMPLOS) {
        exemplosRejeitados.push({ linha: i + 2, valor: bruto || '(vazio)', motivo: t.motivo });
      }
      return;
    }

    if (vistas.has(t.chaveDedup)) {
      duplicadasNoArquivo++;
      return;
    }
    vistas.add(t.chaveDedup);

    const nome = mapa.nome ? (linha[mapa.nome] ?? '').trim() || null : null;
    const municipio = mapa.municipio ? (linha[mapa.municipio] ?? '').trim() || null : null;

    validas.push({
      nome,
      primeiroNome: primeiroNomeDe(nome),
      e164: t.e164,
      chaveDedup: t.chaveDedup,
      municipioNome: municipio,
    });
  });

  return {
    totalLinhas: linhas.length,
    validas,
    duplicadasNoArquivo,
    invalidas,
    porMotivo,
    exemplosRejeitados,
  };
}

/** Casa o nome de cidade da planilha com a lista fechada de municípios. */
export function casarMunicipio(
  nomeBruto: string | null | undefined,
  municipios: { id: number; nome: string }[],
): number | null {
  if (!nomeBruto) return null;
  const alvo = chaveCidade(nomeBruto);
  if (!alvo) return null;
  const achado = municipios.find((m) => chaveCidade(m.nome) === alvo);
  return achado?.id ?? null;
}

/** Divide em blocos para não estourar o tempo da função serverless. */
export function emBlocos<T>(itens: T[], tamanho: number): T[][] {
  const blocos: T[][] = [];
  for (let i = 0; i < itens.length; i += tamanho) blocos.push(itens.slice(i, i + tamanho));
  return blocos;
}
