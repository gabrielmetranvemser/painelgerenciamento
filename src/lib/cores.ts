/**
 * Conta de cor: contraste, mistura e transparência.
 *
 * Nasceu dentro da página pública do candidato, onde a identidade da campanha
 * é escolhida em runtime e o resto do tema precisa ser DERIVADO dela — texto
 * legível sobre o fundo que o gestor colou, borda um passo acima da superfície.
 *
 * Saiu de lá quando o cartão de compartilhamento passou a precisar das mesmas
 * contas: a página e a imagem que o WhatsApp mostra têm de sair com as mesmas
 * cores, e duas cópias das mesmas fórmulas divergem no dia em que alguém
 * ajustar uma só. Arquivo neutro de propósito — nem `server-only` nem
 * `'use client'` —, porque os dois lados e os testes o importam.
 */

/** Os três canais de um `#rrggbb`. */
function canais(hex: string): [number, number, number] {
  const limpo = hex.trim().replace('#', '');
  const cheio = limpo.length === 3 ? limpo.split('').map((c) => c + c).join('') : limpo;
  const n = parseInt(cheio, 16);
  if (Number.isNaN(n) || cheio.length !== 6) return [0, 0, 0];
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/**
 * O brilho percebido de uma cor, de 0 a 1.
 *
 * Luminância relativa (WCAG), não média dos canais: o olho enxerga o verde
 * muito mais que o azul, e a média escolheria branco sobre amarelo — botão
 * ilegível.
 */
export function luminancia(hex: string): number {
  const c = canais(hex).map((v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

/** Preto ou branco por cima de uma cor, pelo brilho percebido. */
export function contrasta(hex: string): string {
  return luminancia(hex) > 0.42 ? '#111111' : '#ffffff';
}

/** `true` quando a cor é clara o bastante para pedir tinta escura em cima. */
export function ehClara(hex: string): boolean {
  return luminancia(hex) > 0.42;
}

/** Mistura duas cores. `p` é quanto de `a` entra. */
export function mistura(a: string, b: string, p: number): string {
  const [x, y] = [canais(a), canais(b)];
  const n = x.map((v, i) => Math.round(v * p + y[i] * (1 - p)));
  return `#${n.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** A mesma cor, com transparência. */
export function comAlfa(hex: string, alfa: number): string {
  const [r, g, b] = canais(hex);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

/** Um passo de contraste: clareia cor escura, escurece cor clara. */
export function degrau(hex: string): string {
  return mistura(ehClara(hex) ? '#000000' : '#ffffff', hex, 0.06);
}
