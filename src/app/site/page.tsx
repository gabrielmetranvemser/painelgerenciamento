import type { Metadata } from 'next';
import Link from 'next/link';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { Cartao } from '@/components/ui';
import type { Municipio } from '@/lib/tipos-banco';
import { FormularioSite } from './formulario';

// Lê a configuração a cada acesso: o gestor edita candidato e cargo pelo painel.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Receba o material da campanha',
  description: 'Cadastre-se para receber o material da campanha pelo WhatsApp.',
  robots: { index: true, follow: true },
};

/**
 * Captação pelo site. Mesmo destino do /kit — fila QUENTE, com consentimento
 * gravado — só que sem endereço e sem itens, para quem só quer o material.
 *
 * É a forma mais barata de trocar lead ruim por lead bom: quem chega por aqui
 * pediu contato, converte muito melhor e praticamente não bloqueia o número.
 */
export default async function PaginaSite() {
  const supabase = criarClienteAdmin();

  const [{ data: cfg }, { data: municipios }] = await Promise.all([
    supabase.from('config').select('candidato, cargo, numero').eq('id', 1).single(),
    supabase.from('municipios').select('*').order('nome'),
  ]);

  return (
    <main className="mx-auto w-full max-w-lg flex-1 p-6">
      <header className="mb-6 text-center">
        <p className="text-sm text-suave">
          {cfg?.cargo} {cfg?.numero && `· nº ${cfg.numero}`}
        </p>
        <h1 className="mt-1 text-2xl font-semibold">{cfg?.candidato}</h1>
        <p className="mt-3 text-[15px] text-suave">
          Deixe seu contato para receber as propostas pelo WhatsApp. Uma pessoa da equipe fala
          com você — sem robô e sem lista de transmissão.
        </p>
      </header>

      <Cartao className="p-6">
        <FormularioSite municipios={(municipios ?? []) as Municipio[]} />
      </Cartao>

      <p className="mt-6 text-center text-xs text-suave">
        Quer também santinho, adesivo ou camiseta?{' '}
        <Link href="/kit" className="underline underline-offset-4">Peça seu kit</Link>.
      </p>
      <p className="mt-2 text-center text-xs text-suave">
        Seus dados são usados só para esta campanha e não são vendidos nem cedidos.{' '}
        <Link href="/privacidade" className="underline underline-offset-4">
          Como tratamos seus dados
        </Link>
        .
      </p>
    </main>
  );
}
