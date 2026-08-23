'use client';

import Link, { useLinkStatus } from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { Loader2, Menu, X } from 'lucide-react';
import { itemAtivo } from '@/lib/nav';
import { cx } from './ui';

export type ItemMenu = {
  href: string;
  rotulo: string;
  icone: ReactNode;
  /** Número em destaque ao lado do rótulo. Zero não aparece. */
  aviso?: number;
  /** Aviso em vermelho, e não em âmbar: risco jurídico. */
  urgente?: boolean;
};

export type GrupoMenu = { titulo: string; itens: ItemMenu[] };

/**
 * Menu do gestor.
 *
 * Eram onze abas numa barra horizontal, que passou a rolar — e aba que rola é
 * aba que ninguém encontra. Em coluna elas cabem todas, e ainda dá para
 * agrupar: quem procura "de onde vêm os contatos" não pensa na mesma gaveta de
 * quem procura "quem está atendendo".
 *
 * Abaixo de `lg` a coluna vira gaveta: em tela estreita uma barra lateral fixa
 * comeria metade do conteúdo.
 */
export function MenuLateral({
  grupos, titulo, rodape,
}: {
  grupos: GrupoMenu[];
  titulo: ReactNode;
  rodape: ReactNode;
}) {
  const [aberto, setAberto] = useState(false);
  const caminho = usePathname();

  const ativo = itemAtivo(caminho, grupos.flatMap((g) => g.itens.map((i) => i.href)));
  const atual = grupos.flatMap((g) => g.itens).find((i) => i.href === ativo);

  // Navegou: fecha a gaveta. Sem isto ela fica por cima da tela que acabou de
  // abrir, e a pessoa tem de fechar na mão toda vez.
  //
  // Ajuste durante a renderização, e não num efeito: é o padrão que o React
  // prevê para "estado que depende de outro". Num efeito, a gaveta ainda
  // apareceria por um quadro sobre a tela nova antes de sumir.
  const [caminhoAnterior, setCaminhoAnterior] = useState(caminho);
  if (caminho !== caminhoAnterior) {
    setCaminhoAnterior(caminho);
    setAberto(false);
  }

  // Tecla Esc fecha, que é o que todo mundo tenta primeiro.
  useEffect(() => {
    if (!aberto) return;
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') setAberto(false); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aberto]);

  const coluna = (
    <nav className="flex h-full flex-col gap-6 overflow-y-auto px-3 py-5">
      <div className="px-2">{titulo}</div>

      <div className="flex-1 space-y-6">
        {grupos.map((g) => (
          <div key={g.titulo}>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-[0.1em] text-tenue">
              {g.titulo}
            </p>
            <ul className="space-y-0.5">
              {g.itens.map((i) => (
                <li key={i.href}>
                  <Link
                    href={i.href}
                    aria-current={i.href === ativo ? 'page' : undefined}
                    className={cx(
                      'flex items-center gap-2.5 rounded-2xl px-3 py-2 text-sm font-medium transition-colors',
                      i.href === ativo
                        ? 'bg-superficie-alta text-texto'
                        : 'text-suave hover:bg-superficie-alta/60 hover:text-texto',
                    )}
                  >
                    <IconeDoItem icone={i.icone} />
                    <span className="truncate">{i.rotulo}</span>
                    {i.aviso ? <Aviso n={i.aviso} urgente={i.urgente} /> : null}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>

      <div className="border-t border-borda px-2 pt-4">{rodape}</div>
    </nav>
  );

  return (
    <>
      {/* Barra estreita: só o nome da tela e o botão da gaveta. */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-borda bg-vidro px-4 py-3 backdrop-blur-2xl backdrop-saturate-150 lg:hidden">
        <button type="button" onClick={() => setAberto(true)}
                aria-label="Abrir menu" aria-expanded={aberto}
                className="grid size-9 place-items-center rounded-full border border-borda text-suave transition-colors hover:border-borda-forte hover:text-texto">
          <Menu size={16} />
        </button>
        <span className="truncate text-sm font-semibold">{atual?.rotulo ?? 'Painel'}</span>
        <span className="ml-auto">{rodape}</span>
      </header>

      {aberto && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <button type="button" aria-label="Fechar menu" onClick={() => setAberto(false)}
                  className="absolute inset-0 bg-fundo/70 backdrop-blur-sm" />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] border-r border-borda bg-superficie shadow-[var(--sombra-alta)]">
            <button type="button" onClick={() => setAberto(false)} aria-label="Fechar menu"
                    className="absolute right-3 top-4 grid size-8 place-items-center rounded-full text-suave hover:bg-superficie-alta hover:text-texto">
              <X size={16} />
            </button>
            {coluna}
          </div>
        </div>
      )}

      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 border-r border-borda bg-superficie/40 lg:block">
        {coluna}
      </aside>
    </>
  );
}

/** Girador no item clicado enquanto a tela dinâmica não responde. */
function IconeDoItem({ icone }: { icone: ReactNode }) {
  const { pending } = useLinkStatus();
  if (pending) return <Loader2 size={15} className="shrink-0 animate-spin" />;
  return <span className="grid size-[15px] shrink-0 place-items-center">{icone}</span>;
}

function Aviso({ n, urgente }: { n: number; urgente?: boolean }) {
  return (
    <span className={cx(
      'ml-auto min-w-5 rounded-full px-1.5 py-0.5 text-center text-[11px] font-bold tabular-nums',
      urgente ? 'bg-perigo text-fundo' : 'bg-alerta/20 text-alerta',
    )}>
      {n}
    </span>
  );
}
