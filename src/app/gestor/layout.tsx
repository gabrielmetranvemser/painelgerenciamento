import { Headphones, LogOut } from 'lucide-react';
import Link from 'next/link';
import {
  FileBarChart, Gauge, MessageSquareText, Settings, Smartphone, Upload, Users,
} from 'lucide-react';
import { exigirGestor } from '@/lib/sessao';
import { sair } from '@/app/entrar/acoes';
import { Avatar } from '@/components/ui';
import { BarraNav } from '@/components/barra-nav';

const ABAS = [
  { href: '/gestor', rotulo: 'Visão geral', icone: <Gauge size={15} /> },
  { href: '/gestor/importar', rotulo: 'Importar', icone: <Upload size={15} /> },
  { href: '/gestor/atendentes', rotulo: 'Atendentes', icone: <Users size={15} /> },
  { href: '/gestor/chips', rotulo: 'Números', icone: <Smartphone size={15} /> },
  { href: '/gestor/mensagens', rotulo: 'Mensagens', icone: <MessageSquareText size={15} /> },
  { href: '/gestor/relatorios', rotulo: 'Relatórios', icone: <FileBarChart size={15} /> },
  { href: '/gestor/configuracao', rotulo: 'Configuração', icone: <Settings size={15} /> },
];

export default async function LayoutGestor({ children }: { children: React.ReactNode }) {
  const gestor = await exigirGestor();

  return (
    <div className="flex min-h-full flex-col">
      <header className="sticky top-0 z-30 border-b border-borda bg-vidro backdrop-blur-2xl backdrop-saturate-150">
        <div className="mx-auto flex w-full max-w-7xl items-center gap-4 px-4 py-3 sm:px-6">
          <BarraNav abas={ABAS} />
          <div className="ml-auto flex items-center gap-2">
            <Link
              href="/painel"
              title="Ir para o atendimento"
              className="grid size-8 place-items-center rounded-full text-suave transition-colors hover:bg-superficie-alta hover:text-texto"
            >
              <Headphones size={15} />
            </Link>
            <Avatar nome={gestor.primeiro_nome} fotoUrl={gestor.foto_url} tamanho="p" />
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
      <main className="surgir mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:px-6">{children}</main>
    </div>
  );
}
