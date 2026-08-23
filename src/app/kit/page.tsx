import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { Cartao } from '@/components/ui';
import type { Municipio } from '@/lib/tipos-banco';
import { FormularioKit } from './formulario';

// Lê a configuração a cada acesso: o gestor edita candidato, cargo e textos
// pelo painel, e a página não pode ficar congelada no que valia no build.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Peça seu kit',
  description: 'Peça santinho, adesivo e camiseta da campanha.',
  robots: { index: true, follow: true },
};

/**
 * Página de captação do kit.
 *
 * Doc 1 §7: é a peça mais valiosa do projeto e a mais subvalorizada. Pedir
 * material é o motivo mais natural do mundo para alguém entregar nome, telefone
 * e cidade POR VONTADE PRÓPRIA — troca lead ruim (lista fria) por lead bom
 * (opt-in gravado), e ainda mostra no mapa onde estão os apoiadores reais.
 */
export default async function PaginaKit() {
  const supabase = criarClienteAdmin();

  const [{ data: cfg }, { data: municipios }] = await Promise.all([
    supabase.from('config').select('candidato, cargo, numero, kit_ativo').eq('id', 1).single(),
    supabase.from('municipios').select('*').order('nome'),
  ]);

  if (!cfg?.kit_ativo) notFound();

  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-6">
      <header className="mb-6 text-center">
        <p className="text-sm text-suave">
          {cfg.cargo} {cfg.numero && `· nº ${cfg.numero}`}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{cfg.candidato}</h1>
        <p className="mt-3 text-[15px] text-suave">
          Peça seu santinho, adesivo de carro ou camiseta. É de graça e a gente combina a entrega
          pelo WhatsApp.
        </p>
      </header>

      <Cartao className="p-6">
        <FormularioKit municipios={(municipios ?? []) as Municipio[]} />
      </Cartao>

      <p className="mt-6 text-center text-xs text-suave">
        Seus dados são usados só para esta campanha e não são vendidos nem cedidos.{' '}
        <Link href="/privacidade" className="underline underline-offset-4">
          Como tratamos seus dados
        </Link>
        .
      </p>
    </main>
  );
}
