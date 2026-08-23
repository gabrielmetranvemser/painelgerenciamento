import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { BotaoLink, Metrica, Titulo, Vazio } from '@/components/ui';
import { rotas } from '@/lib/links-internos';
import { Box, PackageCheck } from 'lucide-react';
import type { Entrega } from '@/lib/tipos-banco';
import { ListaEntregas } from './lista';

export const metadata: Metadata = { title: 'Entregas' };
export const dynamic = 'force-dynamic';

export default async function PaginaEntregas({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from('v_entregas')
    .select('*')
    .order('pedido_em', { ascending: true })
    .limit(2000);

  const entregas = (data ?? []) as Entrega[];
  const pendentes = entregas.filter((e) => e.estado === 'pendente');
  const entregues = entregas.filter((e) => e.estado === 'entregue');
  const cancelados = entregas.filter((e) => e.estado === 'cancelado');

  const itens = pendentes
    .flatMap((e) => e.itens ?? [])
    .reduce<Record<string, number>>((acc, i) => ({ ...acc, [i]: (acc[i] ?? 0) + 1 }), {});

  return (
    <>
      <Titulo sub="Quem pediu santinho, adesivo ou camiseta — com endereço, data do pedido e o que já saiu.">
        Entregas
      </Titulo>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica rotulo="A entregar" valor={pendentes.length} tom="alerta" icone={<Box size={14} />} />
        <Metrica rotulo="Entregues" valor={entregues.length} tom="acento" icone={<PackageCheck size={14} />} />
        <Metrica rotulo="Cancelados" valor={cancelados.length} />
        <Metrica
          rotulo="Peças a separar"
          valor={Object.values(itens).reduce((a, b) => a + b, 0)}
          detalhe={
            Object.entries(itens)
              .map(([nome, n]) => `${n} ${nome}${n > 1 ? 's' : ''}`)
              .join(' · ') || undefined
          }
        />
      </div>

      {entregas.length === 0 ? (
        <Vazio icone={<Box size={20} />}>
          Nenhum pedido de material impresso ainda. Eles chegam pela página do candidato e pelo
          bloco &ldquo;Pedido de kit&rdquo; que o atendente preenche durante a conversa.
        </Vazio>
      ) : (
        <ListaEntregas entregas={entregas} />
      )}

      <div className="mt-6">
        <BotaoLink href={rotas(entrada).exportar('kit')} variante="neutro" tamanho="p" prefetch={false}>
          Baixar CSV para a rua
        </BotaoLink>
      </div>
    </>
  );
}
