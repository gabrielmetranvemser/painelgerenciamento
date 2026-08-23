import Link from 'next/link';
import { exigirGestor } from '@/lib/sessao';
import { sair } from '@/app/entrar/acoes';

const ABAS = [
  { href: '/gestor', rotulo: 'Visão geral' },
  { href: '/gestor/importar', rotulo: 'Importar lista' },
  { href: '/gestor/atendentes', rotulo: 'Atendentes' },
  { href: '/gestor/chips', rotulo: 'Números' },
  { href: '/gestor/mensagens', rotulo: 'Mensagens' },
  { href: '/gestor/relatorios', rotulo: 'Relatórios' },
  { href: '/gestor/configuracao', rotulo: 'Configuração' },
];

export default async function LayoutGestor({ children }: { children: React.ReactNode }) {
  const gestor = await exigirGestor();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-borda bg-superficie">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-5 px-5 py-3">
          <Link href="/gestor" className="text-sm font-semibold">Gestor</Link>
          <Link href="/painel" className="text-sm text-suave hover:text-texto">Atender</Link>
          <form action={sair} className="ml-auto flex items-center gap-4">
            <span className="text-sm text-suave">{gestor.primeiro_nome}</span>
            <button className="text-sm text-suave hover:text-texto">Sair</button>
          </form>
        </div>
        <nav className="mx-auto flex w-full max-w-7xl gap-1 overflow-x-auto px-3 pb-2">
          {ABAS.map((a) => (
            <Link
              key={a.href}
              href={a.href}
              className="whitespace-nowrap rounded-lg px-3 py-1.5 text-sm text-suave hover:bg-fundo hover:text-texto"
            >
              {a.rotulo}
            </Link>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 p-5">{children}</main>
    </div>
  );
}
