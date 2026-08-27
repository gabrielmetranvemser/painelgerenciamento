/**
 * A cor do ponto de cada lista.
 *
 * O ponto existe para o atendente que atende três listas reconhecer de qual
 * veio o contato sem parar para ler. Não carrega significado nenhum — quem
 * carrega significado é a paleta de negócio (lima = positivo, âmbar = fila
 * quente, azul-gelo = fila fria), e por isso as cores de lista são outras e só
 * aparecem como ponto, nunca como preenchimento.
 *
 * A cor sai de um embaralhado do id, e não de um campo no banco nem da ordem na
 * tela: assim ela é a MESMA em toda tela e não muda quando uma lista é
 * importada, pausada ou renomeada. Cor que troca de lugar sozinha é pior que
 * cor nenhuma — o atendente decora a errada.
 *
 * São nomes de variável CSS, e não classe do Tailwind: classe montada por
 * interpolação (`bg-${cor}`) não existe no CSS final, porque a varredura do
 * Tailwind só enxerga nomes literais.
 */
export const CORES_LISTA = [
  'var(--lista-1)',
  'var(--lista-2)',
  'var(--lista-3)',
  'var(--lista-4)',
  'var(--lista-5)',
  'var(--lista-6)',
] as const;

export function corDaLista(id: string): string {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    // O mesmo embaralhado de sempre (h * 31 + código), preso a 32 bits sem
    // sinal para o resto da divisão nunca sair negativo.
    h = (Math.imul(h, 31) + id.charCodeAt(i)) >>> 0;
  }
  return CORES_LISTA[h % CORES_LISTA.length];
}
