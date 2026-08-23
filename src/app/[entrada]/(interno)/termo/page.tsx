import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { usuarioAtual } from '@/lib/sessao';
import { Cartao, Titulo } from '@/components/ui';
import { FormularioTermo } from './formulario';

export const metadata: Metadata = { title: 'Termo de uso' };

export default async function Termo({ params }: { params: Promise<{ entrada: string }> }) {
  const { entrada } = await params;
  const usuario = await usuarioAtual();
  if (!usuario) redirect(`/${entrada}/entrar`);
  if (usuario.termo_aceito_em) redirect(`/${entrada}/painel`);

  const supabase = await criarClienteServidor();
  const { data: cfg } = await supabase.from('config').select('termo_texto').eq('id', 1).single();

  return (
    <main className="surgir mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <Titulo sub={`${usuario.primeiro_nome}, leia antes de começar. Fica gravado com data e hora.`}>
        Termo de uso
      </Titulo>

      <Cartao className="mb-6 p-7">
        <div className="whitespace-pre-line text-[15px] leading-[1.75]">
          {cfg?.termo_texto || 'O gestor ainda não cadastrou o texto do termo.'}
        </div>
      </Cartao>

      <FormularioTermo entrada={entrada} />
    </main>
  );
}
