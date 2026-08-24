'use client';

import { useSyncExternalStore } from 'react';

/**
 * O chip que o atendente escolheu, guardado no navegador.
 *
 * Vive aqui, e não dentro de uma tela, porque DUAS telas dependem dele: a de
 * atendimento e o botão de adicionar contato. Se cada uma lesse por conta
 * própria, o contato cadastrado poderia nascer preso a um número diferente do
 * que a pessoa realmente chamou.
 *
 * `useSyncExternalStore` é o mecanismo que o React prevê para armazenamento
 * externo: no servidor devolve null, no cliente o valor guardado — sem
 * remontagem e sem divergência de hidratação.
 *
 * ⚠️ TODO ACESSO VAI DENTRO DE try/catch, e isso não é excesso de zelo.
 *
 * Dentro do painel lateral do Chrome a página de topo é `chrome-extension://`,
 * então o painel roda como conteúdo de terceiro. Quando o navegador bloqueia
 * armazenamento de terceiro — o padrão que o Chrome vem ampliando —, LER
 * `window.localStorage` não devolve null: **lança** `SecurityError`. Como a
 * leitura acontece durante a renderização, a exceção derrubava a tela inteira,
 * e o atendente via uma página em branco sem nenhuma pista do motivo.
 *
 * Sem armazenamento o painel continua funcionando: perde-se só a memória de
 * qual número estava escolhido, e a tela cai no primeiro chip da lista.
 */

export const CHAVE_CHIP = 'chip';

function assinarArmazenamento(aoMudar: () => void) {
  window.addEventListener('storage', aoMudar);
  return () => window.removeEventListener('storage', aoMudar);
}

function lerChip(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_CHIP);
  } catch {
    return null;
  }
}

/** Guarda a escolha. Silenciosa quando o navegador não deixa: não é essencial. */
export function guardarChip(id: string): void {
  try {
    window.localStorage.setItem(CHAVE_CHIP, id);
  } catch {
    // Armazenamento bloqueado (painel lateral com cookie de terceiro barrado,
    // ou navegação anônima). A escolha vale para esta sessão e pronto.
  }
}

export function useChipSalvo(): string | null {
  return useSyncExternalStore(assinarArmazenamento, lerChip, () => null);
}
