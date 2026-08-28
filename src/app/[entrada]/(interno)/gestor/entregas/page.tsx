import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { buscarTudo } from '@/lib/supabase/paginar';
import { BotaoLink, Metrica, Titulo, Vazio } from '@/components/ui';
import { rotas } from '@/lib/links-internos';
import { Box, PackageCheck } from 'lucide-react';
import type { Entrega } from '@/lib/tipos-banco';
import { carregarItensKitTodos } from '@/lib/acoes-itens-kit';
import { rotuloDoItem } from '@/lib/itens-kit';
import { ListaEntregas } from './lista';
import { CadastroDeItens } from './itens';

export const metadata: Metadata = { title: 'Entregas' };
export const dynamic = 'force-dynamic';

export default async function PaginaEntregas({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const supabase = await criarClienteServidor();

  // Em blocos: `.limit(2000)` era cortado em 1.000 pelo PostgREST sem aviso, e
  // os quatro números do topo — inclusive "peças a separar" — saíam menores que
  // a realidade. Contagem para a rua não pode ser palpite.
  const entregas = await buscarTudo<Entrega>((de, ate) =>
    supabase
      .from('v_entregas')
      .select('*')
      .order('pedido_em', { ascending: true })
      .range(de, ate),
  );
  // Todos, inclusive os desativados: quem pediu um item que saiu do cadastro
  // continua na fila de entrega, e o entregador precisa do rótulo.
  const itensKit = await carregarItensKitTodos();

  const pendentes = entregas.filter((e) => e.estado === 'pendente');
  const entregues = entregas.filter((e) => e.estado === 'entregue');
  const cancelados = entregas.filter((e) => e.estado === 'cancelado');

  const itens = pendentes
    .flatMap((e) => e.itens ?? [])
    .reduce<Record<string, number>>((acc, i) => ({ ...acc, [i]: (acc[i] ?? 0) + 1 }), {});

  return (
    <>
      <Titulo sub="Quem pediu material impresso — com endereço, data do pedido e o que já saiu. Os itens que a pessoa pode pedir são cadastrados abaixo.">
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
            // Rótulo do cadastro, não a chave crua — "3 Santinhos", e não
            // "3 santinhos" nem "3 bone_grande".
            Object.entries(itens)
              .map(([chave, n]) => `${n} ${rotuloDoItem(chave, itensKit)}${n > 1 ? 's' : ''}`)
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
        <ListaEntregas entregas={entregas} itensKit={itensKit} />
      )}

      <div className="mt-8">
        <CadastroDeItens itens={itensKit} />
      </div>

      <div className="mt-6">
        <BotaoLink href={rotas(entrada).exportar('kit')} variante="neutro" tamanho="p" prefetch={false}>
          Baixar CSV para a rua
        </BotaoLink>
      </div>
    </>
  );
}
