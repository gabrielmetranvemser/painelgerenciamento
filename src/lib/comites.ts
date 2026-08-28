/**
 * Comitês: a forma dos dados e a conta de "qual está mais perto".
 *
 * Arquivo NEUTRO — servidor e cliente importam daqui. Sem rede e sem estado:
 * quem busca coordenada é `busca-cep.ts`, quem calcula distância é
 * `distancia.ts`.
 */

import { distanciaKm, type Ponto } from './distancia';

export type Comite = {
  id: string;
  nome: string;
  /** Nome de urna do candidato. Só na visão do atendente. */
  candidato?: string | null;
  municipio: string | null;
  municipio_id: number | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  latitude: number | null;
  longitude: number | null;
  horario: string | null;
  telefone: string | null;
};

/**
 * O comitê mais perto, e como ele foi escolhido.
 *
 * ⚠️ SÃO DOIS CRITÉRIOS, e a diferença entre eles é o que a tela diz:
 *
 *   'distancia'  as duas pontas têm coordenada. Dá para dizer quantos km — em
 *                LINHA RETA, e a tela precisa escrever isso.
 *   'municipio'  não dá para calcular (o CEP da pessoa é de município inteiro,
 *                ou o comitê ainda não tem coordenada), mas os dois estão na
 *                mesma cidade. Vale dizer que existe, sem número.
 *
 * Sem nenhum dos dois, devolve `null` — e a tela não fala em comitê nenhum.
 * Anunciar um comitê a 400 km como se fosse perto é pior do que não anunciar.
 */
export type ComitePerto =
  | { comite: Comite; criterio: 'distancia'; km: number }
  | { comite: Comite; criterio: 'municipio' }
  | null;

export function comiteMaisPerto(
  comites: readonly Comite[],
  pessoa: { ponto: Ponto | null; municipioId: number | null },
): ComitePerto {
  if (comites.length === 0) return null;

  if (pessoa.ponto) {
    const comCoordenada = comites
      .filter((c) => c.latitude !== null && c.longitude !== null)
      .map((c) => ({
        comite: c,
        km: distanciaKm(pessoa.ponto!, { lat: c.latitude!, lon: c.longitude! }),
      }))
      .sort((a, b) => a.km - b.km);

    if (comCoordenada.length > 0) {
      const perto = comCoordenada[0];
      return { comite: perto.comite, criterio: 'distancia', km: perto.km };
    }
  }

  if (pessoa.municipioId !== null) {
    const naCidade = comites.find((c) => c.municipio_id === pessoa.municipioId);
    if (naCidade) return { comite: naCidade, criterio: 'municipio' };
  }

  return null;
}

/** "Av. Pinheiro Machado, 1200 — Centro". Só o que existir. */
export function enderecoDoComite(c: Comite): string {
  const rua = [c.rua, c.numero].filter(Boolean).join(', ');
  return [rua, c.bairro, c.municipio].filter(Boolean).join(' — ');
}
