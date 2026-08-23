import { Headphones, LayoutGrid, LogOut, Users } from 'lucide-react';
import { exigirAtendente } from '@/lib/sessao';
import { sair } from '@/app/entrar/acoes';
import { Avatar } from '@/components/ui';
import { BarraNav } from '@/components/barra-nav';

export default async function LayoutPainel({ children }: { children: React.ReactNode }) {
  const usuario = await exigirAtendente();

  const abas = [
    { href: '/painel', rotulo: 'Atender', icone: <Headphones size={15} /> },
    { href: '/painel/meus-contatos', rotulo: 'Meus contatos', icone: <Users size={15} /> },
    ...(usuario.papel === 'gestor'
      ? [{ href: '/gestor', rotulo: 'Gestor', icone: <LayoutGrid size={15} /> }]
      : []),
  ];

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-borda bg-vidro backdrop-blur-2xl backdrop-saturate-150">
        <div className="mx-auto flex w-full max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
          <BarraNav abas={abas} />
          <div className="ml-auto flex items-center gap-3">
            <span className="hidden text-sm font-medium sm:block">{usuario.primeiro_nome}</span>
            <Avatar nome={usuario.primeiro_nome} fotoUrl={usuario.foto_url} tamanho="p" />
            <form action={sair}>
              <button
                title="Sair"
                className="grid size-8 place-items-center rounded-full text-suave transition-colors hover:bg-superficie-alta hover:text-texto"
              >
                <LogOut size={15} />
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="surgir mx-auto w-full max-w-6xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
