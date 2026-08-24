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
 */

export const CHAVE_CHIP = 'chip';

function assinarArmazenamento(aoMudar: () => void) {
  window.addEventListener('storage', aoMudar);
  return () => window.removeEventListener('storage', aoMudar);
}

export function useChipSalvo(): string | null {
  return useSyncExternalStore(
    assinarArmazenamento,
    () => window.localStorage.getItem(CHAVE_CHIP),
    () => null,
  );
}
