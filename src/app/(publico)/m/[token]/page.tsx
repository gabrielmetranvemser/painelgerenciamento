import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { Cartao } from '@/components/ui';
import { Descadastro } from './descadastro';

// Página pessoal, uma por contato: nunca deve ser indexada.
export const metadata: Metadata = {
  title: 'Material da campanha',
  robots: { index: false, follow: false },
};

export default async function PaginaMaterial({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = criarClienteAdmin();

  const { data: link } = await supabase
    .from('links')
    .select('token, contato_id')
    .eq('token', token)
    .maybeSingle();

  if (!link) notFound();

  const { data: cfg } = await supabase
    .from('config')
    .select('candidato, cargo, numero, material_titulo, material_texto')
    .eq('id', 1)
    .single();

  // O clique no canal também passa por /r/, senão a entrada no canal — que é o
  // objetivo real do primeiro contato — fica sem medição.
  const { data: tokenCanal } = await supabase.rpc('garantir_link', {
    p_contato_id: link.contato_id,
    p_destino_chave: 'canal',
  });

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 sm:px-6">
      <Cartao className="p-7" elevado>
        <p className="text-sm text-suave">
          {cfg?.cargo} {cfg?.numero && `· nº ${cfg.numero}`}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{cfg?.candidato}</h1>

        <h2 className="mt-6 text-lg font-medium">{cfg?.material_titulo}</h2>
        <div className="mt-2 whitespace-pre-line text-[15px] leading-relaxed">
          {cfg?.material_texto}
        </div>

        {tokenCanal && (
          <a
            href={`/r/${tokenCanal}`}
            className="mt-7 inline-flex w-full items-center justify-center rounded-full bg-acento px-6 py-4 font-semibold text-tinta-acento transition-colors hover:bg-acento-alto"
          >
            Entrar no canal da campanha
          </a>
        )}
        <p className="mt-2 text-center text-xs text-suave">
          Você entra por vontade própria e pode sair quando quiser.
        </p>
      </Cartao>

      <div className="mt-6 space-y-4">
        <Descadastro token={token} />
        <p className="text-xs leading-relaxed text-suave">
          Seus dados são usados apenas para este contato de campanha e não são vendidos nem cedidos.{' '}
          <Link href="/privacidade" className="underline underline-offset-4">
            Como tratamos seus dados
          </Link>
          .
        </p>
      </div>
    </main>
  );
}
