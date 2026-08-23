import type { Metadata } from 'next';
import { Headphones } from 'lucide-react';
import { Aviso, Cartao } from '@/components/ui';
import { FormularioEntrar } from './formulario';

export const metadata: Metadata = { title: 'Entrar' };

export default async function Entrar({
  params, searchParams,
}: {
  params: Promise<{ entrada: string }>;
  searchParams: Promise<{ proximo?: string; erro?: string }>;
}) {
  const { entrada } = await params;
  const { proximo, erro } = await searchParams;

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="surgir w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-acento text-tinta-acento">
            <Headphones size={22} />
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Painel</h1>
          <p className="mt-1.5 text-sm text-suave">Acesso restrito à equipe.</p>
        </div>

        <Cartao className="p-7" elevado>
          {erro === 'inativo' && (
            <Aviso tom="erro" className="mb-4">
              Sua conta está inativa. Fale com o gestor.
            </Aviso>
          )}
          <FormularioEntrar proximo={proximo ?? ''} entrada={entrada} />
        </Cartao>

        <p className="mt-6 text-center text-xs text-suave">
          Não existe cadastro por conta própria. O gestor cria as contas.
        </p>
      </div>
    </main>
  );
}
