'use client';

import { useSyncExternalStore } from 'react';

/**
 * A lista que o atendente escolheu trabalhar, guardada no navegador.
 *
 * Nulo — a chave ausente — quer dizer "todas as listas", que é o padrão: a fila
 * mistura tudo e o contato chega etiquetado. Quem escolhe uma lista específica
 * está no modo manual e continua nele depois de recarregar a página, senão a
 * escolha se perderia a cada F5 no meio do turno.
 *
 * ⚠️ Todo acesso vai dentro de try/catch pelo mesmo motivo de
 * `chip-salvo.ts` — que é onde o porquê está escrito por extenso: dentro do
 * painel lateral do Chrome, LER `window.localStorage` não devolve null, lança
 * `SecurityError`, e a leitura acontece durante a renderização. Sem o catch, a
 * tela inteira cai em branco.
 */

export const CHAVE_LISTA = 'lista';

function assinarArmazenamento(aoMudar: () => void) {
  window.addEventListener('storage', aoMudar);
  return () => window.removeEventListener('storage', aoMudar);
}

function lerLista(): string | null {
  try {
    return window.localStorage.getItem(CHAVE_LISTA);
  } catch {
    return null;
  }
}

/** `null` volta para "todas as listas". Silenciosa quando o navegador não deixa. */
export function guardarLista(id: string | null): void {
  try {
    if (id === null) window.localStorage.removeItem(CHAVE_LISTA);
    else window.localStorage.setItem(CHAVE_LISTA, id);
  } catch {
    // Armazenamento bloqueado. A escolha vale para esta sessão e pronto.
  }
}

export function useListaSalva(): string | null {
  return useSyncExternalStore(assinarArmazenamento, lerLista, () => null);
}
