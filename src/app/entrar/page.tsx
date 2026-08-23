import type { Metadata } from 'next';
import { Aviso, Cartao } from '@/components/ui';
import { FormularioEntrar } from './formulario';

export const metadata: Metadata = { title: 'Entrar' };

export default async function Entrar({
  searchParams,
}: {
  searchParams: Promise<{ proximo?: string; erro?: string }>;
}) {
  const { proximo, erro } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="w-full max-w-sm">
        <h1 className="mb-1 text-center text-2xl font-semibold">Painel</h1>
        <p className="mb-6 text-center text-sm text-suave">Acesso restrito à equipe.</p>

        <Cartao className="p-6">
          {erro === 'inativo' && (
            <Aviso tom="erro" className="mb-4">
              Sua conta está inativa. Fale com o gestor.
            </Aviso>
          )}
          <FormularioEntrar proximo={proximo ?? '/painel'} />
        </Cartao>

        <p className="mt-6 text-center text-xs text-suave">
          Não existe cadastro por conta própria. O gestor cria as contas.
        </p>
      </div>
    </main>
  );
}
