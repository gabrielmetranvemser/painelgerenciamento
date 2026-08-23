import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { usuarioAtual } from '@/lib/sessao';
import { Cartao } from '@/components/ui';
import { FormularioTermo } from './formulario';

export const metadata: Metadata = { title: 'Termo de uso' };

export default async function Termo() {
  const usuario = await usuarioAtual();
  if (!usuario) redirect('/entrar');
  if (usuario.termo_aceito_em) redirect('/painel');

  const supabase = await criarClienteServidor();
  const { data: cfg } = await supabase.from('config').select('termo_texto').eq('id', 1).single();

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 p-6">
      <h1 className="mb-1 text-2xl font-semibold">Termo de uso</h1>
      <p className="mb-6 text-sm text-suave">
        {usuario.primeiro_nome}, leia antes de começar. Fica gravado com data e hora.
      </p>

      <Cartao className="mb-6 p-6">
        <div className="whitespace-pre-line text-sm leading-relaxed">
          {cfg?.termo_texto || 'O gestor ainda não cadastrou o texto do termo.'}
        </div>
      </Cartao>

      <FormularioTermo />
    </main>
  );
}
