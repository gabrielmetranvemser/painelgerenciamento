import { Headphones, LayoutGrid, LifeBuoy, LogOut, Users, Wrench } from 'lucide-react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import { rotas } from '@/lib/links-internos';
import { sair } from '@/app/[entrada]/(interno)/entrar/acoes';
import { Avatar } from '@/components/ui';
import { BarraNav } from '@/components/barra-nav';
import { NovoContato } from '@/components/novo-contato';
import type { Chip, Municipio } from '@/lib/tipos-banco';

export default async function LayoutPainel({
  children, params,
}: {
  children: React.ReactNode;
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const usuario = await exigirAtendente(entrada);
  const r = rotas(entrada);

  // O botão flutuante vive no layout para estar em TODA tela do atendente:
  // quem manda mensagem por conta própria não espera ele estar na aba certa.
  const supabase = await criarClienteServidor();
  const [{ data: chips }, { data: municipios }] = await Promise.all([
    supabase.from('chips').select('*').eq('atendente_id', usuario.id).order('rotulo'),
    supabase.from('municipios').select('*').order('nome'),
  ]);

  const abas = [
    { href: r.painel, rotulo: 'Atender', icone: <Headphones size={15} /> },
    { href: r.meusContatos, rotulo: 'Meus contatos', icone: <Users size={15} /> },
    { href: r.suporte, rotulo: 'Falar com o gestor', icone: <LifeBuoy size={15} /> },
    { href: r.instalar, rotulo: 'Preparar máquina', icone: <Wrench size={15} /> },
    ...(usuario.papel === 'gestor'
      ? [{ href: r.gestor, rotulo: 'Gestor', icone: <LayoutGrid size={15} /> }]
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
              <input type="hidden" name="entrada" value={entrada} />
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

      <NovoContato
        chips={(chips ?? []) as Chip[]}
        municipios={(municipios ?? []) as Municipio[]}
        rotaPainel={r.painel}
      />
    </div>
  );
}
