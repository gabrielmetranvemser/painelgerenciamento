'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { Loader2 } from 'lucide-react';
import type { ReactNode } from 'react';
import { itemAtivo } from '@/lib/nav';
import { cx } from './ui';

/**
 * Troca o ícone da aba por um girador enquanto a navegação está em curso.
 *
 * Precisa ser um componente próprio: `useLinkStatus` lê o estado do `<Link>`
 * mais próximo acima, então só funciona DENTRO dele.
 */
function IconeDaAba({ icone }: { icone?: ReactNode }) {
  const { pending } = useLinkStatus();
  if (pending) return <Loader2 size={15} className="animate-spin" />;
  return <>{icone}</>;
}

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
  // Vence o casamento mais longo, não o prefixo: com /x/painel e
  // /x/painel/suporte na lista, `startsWith` acendia as duas ao mesmo tempo.
  const ativo = itemAtivo(caminho, abas.map((a) => a.href));

  return (
    <nav className="flex items-center gap-1 overflow-x-auto">
      {abas.map((a) => {
        const ativa = a.href === ativo;
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
            <IconeDaAba icone={a.icone} />
            <span className="hidden sm:inline">{a.rotulo}</span>
          </Link>
        );
      })}
    </nav>
  );
}
