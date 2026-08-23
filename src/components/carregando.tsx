import { Cartao } from './ui';

/**
 * Esqueleto de carregamento.
 *
 * Todas as telas internas são `force-dynamic`: cada navegação espera o servidor
 * responder. Sem isto o clique na aba não devolve nada por um segundo e a tela
 * parece travada — o usuário clica de novo, e de novo.
 *
 * Fica dentro de `loading.tsx` de cada área, e não no layout, para o cabeçalho
 * com as abas continuar na tela: sumir a navegação junto é pior que a espera.
 */
export function Carregando({ blocos = 3 }: { blocos?: number }) {
  return (
    <div className="space-y-5" aria-busy="true" aria-live="polite">
      <span className="sr-only">Carregando…</span>
      <Cartao className="p-5">
        <div className="h-4 w-40 animate-pulse rounded-full bg-superficie-alta" />
        <div className="mt-3 h-3 w-64 animate-pulse rounded-full bg-superficie-alta" />
      </Cartao>
      {Array.from({ length: blocos }, (_, i) => (
        <Cartao key={i} className="p-5">
          <div className="h-3 w-32 animate-pulse rounded-full bg-superficie-alta" />
          <div className="mt-4 space-y-2.5">
            <div className="h-10 animate-pulse rounded-2xl bg-superficie-alta" />
            <div className="h-10 w-4/5 animate-pulse rounded-2xl bg-superficie-alta" />
          </div>
        </Cartao>
      ))}
    </div>
  );
}
