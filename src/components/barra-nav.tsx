'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import type { ReactNode } from 'react';
import { cx } from './ui';

/**
 * Navegação em pílulas, com a aba ativa preenchida.
 * Marcar o lugar onde se está custa um clique a menos de orientação, o dia
 * inteiro.
 */
export function BarraNav({
  abas,
}: {
  abas: { href: string; rotulo: string; icone?: ReactNode }[];
}) {
  const caminho = usePathname();

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {abas.map((a) => {
        const ativa = a.href === caminho || (a.href !== '/painel' && a.href !== '/gestor' && caminho.startsWith(a.href));
        return (
          <Link
            key={a.href}
            href={a.href}
            aria-current={ativa ? 'page' : undefined}
            className={cx(
              'inline-flex shrink-0 items-center gap-2 rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
              ativa
                ? 'bg-texto text-fundo'
                : 'text-suave hover:bg-superficie-alta hover:text-texto',
            )}
          >
            {a.icone}
            <span className="hidden sm:inline">{a.rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}
