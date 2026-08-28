/**
 * Distância entre dois pontos na superfície da Terra.
 *
 * ⚠️ É DISTÂNCIA EM LINHA RETA, e toda tela que mostra o número precisa dizer
 * isso. Em Rondônia a diferença para a distância de estrada é grande — dois
 * pontos a 15 km em linha reta podem estar a 40 km de rodovia, com um rio no
 * meio. Prometer "a 15 km de você" e a pessoa rodar 40 é pior do que não
 * mostrar número nenhum.
 *
 * Funções puras, sem rede. Quem busca coordenada é `src/lib/busca-cep.ts`.
 */

export type Ponto = { lat: number; lon: number };

/** Raio médio da Terra, em quilômetros. */
const RAIO_KM = 6371;

const rad = (g: number) => (g * Math.PI) / 180;

/**
 * Haversine. Erro abaixo de 0,5% para as distâncias que interessam aqui —
 * dezenas ou centenas de quilômetros dentro de um estado.
 */
export function distanciaKm(a: Ponto, b: Ponto): number {
  const dLat = rad(b.lat - a.lat);
  const dLon = rad(b.lon - a.lon);
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * RAIO_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/**
 * `true` quando o par de números pode ser uma coordenada do Brasil.
 *
 * Existe porque coordenada entra no sistema por copiar e colar do Google Maps,
 * e as duas formas de errar são clássicas: inverter latitude com longitude, e
 * colar o número com vírgula decimal virando separador de milhar. As duas
 * produzem um ponto no oceano ou na Ásia — e uma distância de 8.000 km que a
 * tela mostraria com toda a seriedade.
 *
 * A caixa é o Brasil com folga.
 */
export function coordenadaPlausivel(p: Ponto): boolean {
  return (
    Number.isFinite(p.lat) && Number.isFinite(p.lon) &&
    p.lat >= -34 && p.lat <= 6 &&
    p.lon >= -74 && p.lon <= -33
  );
}

/**
 * Lê "−8.76077, −63.8999" — o formato que o Google Maps põe na área de
 * transferência quando alguém clica com o botão direito num ponto.
 *
 * Aceita vírgula decimal ("−8,76077 −63,8999"), que é o que sai quando o
 * aparelho está em português. Devolve `null` para qualquer coisa que não seja
 * um par plausível: é melhor pedir de novo do que gravar um ponto no oceano.
 */
export function lerCoordenada(bruto: string): Ponto | null {
  const texto = String(bruto ?? '').trim();
  if (!texto) return null;

  // Separa os dois números pelo que houver entre eles: vírgula, ponto e vírgula
  // ou espaço. A vírgula decimal é resolvida depois, número a número.
  const partes = texto.split(/[;\s]+|,(?=\s*-?\d+[.,]\d)/).filter(Boolean);
  if (partes.length !== 2) return null;

  const numero = (s: string) => {
    const limpo = s.replace(/[^\d,.\-+]/g, '').replace(',', '.');
    const n = Number(limpo);
    return Number.isFinite(n) ? n : NaN;
  };

  const p = { lat: numero(partes[0]), lon: numero(partes[1]) };
  return coordenadaPlausivel(p) ? p : null;
}

/**
 * A distância como se escreve para alguém, não como se calcula.
 *
 * Abaixo de 1 km vira "menos de 1 km": dizer "a 0,4 km" de um comitê que a
 * pessoa provavelmente enxerga da esquina soa a robô. Acima de 10 km o
 * arredondamento é inteiro — a precisão decimal seria falsa, já que o número é
 * em linha reta.
 */
export function formatarDistancia(km: number): string {
  if (km < 1) return 'menos de 1 km';
  if (km < 10) return `${km.toFixed(1).replace('.', ',')} km`;
  return `${Math.round(km)} km`;
}
