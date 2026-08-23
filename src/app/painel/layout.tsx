import Link from 'next/link';
import { exigirAtendente } from '@/lib/sessao';
import { sair } from '@/app/entrar/acoes';

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const usuario = await exigirAtendente();

  return (
    <div className="flex min-h-full flex-col">
      <header className="border-b border-borda bg-superficie">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-5 px-5 py-3">
          <Link href="/painel" className="text-sm font-semibold">Painel</Link>
          <nav className="flex gap-4 text-sm text-suave">
            <Link href="/painel" className="hover:text-texto">Atender</Link>
            <Link href="/painel/meus-contatos" className="hover:text-texto">Meus contatos</Link>
            {usuario.papel === 'gestor' && (
              <Link href="/gestor" className="hover:text-texto">Gestor</Link>
            )}
          </nav>
          <form action={sair} className="ml-auto">
            <button className="text-sm text-suave hover:text-texto">Sair</button>
          </form>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 p-5">{children}</main>
    </div>
  );
}
