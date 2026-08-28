import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import { Titulo } from '@/components/ui';
import type { StatusContato } from '@/lib/tipos-banco';
// ⚠️ Do arquivo de cliente vem SÓ o componente. Constante importada de um
// módulo 'use client' chega aqui como referência para o navegador, não como
// valor. Ver o cabeçalho de `recortes.ts`.
import { ListaMeusContatos } from './lista';
import { ehStatus, type RespostaMeusContatos } from './recortes';

export const metadata: Metadata = { title: 'Meus contatos' };
export const dynamic = 'force-dynamic';

/**
 * Cinquenta por página.
 *
 * ⚠️ A versão anterior pedia 300 linhas e não filtrava nada. Com o teto de 30
 * conversas por dia, um atendente passa de 300 em duas semanas — e a partir daí
 * os mais antigos sumiam da tela em silêncio, que é exatamente o defeito que a
 * tela de contatos do gestor já teve. Agora quem filtra, conta e pagina é o
 * banco.
 */
const POR_PAGINA = 50;

type Busca = { status?: string; busca?: string; pagina?: string };

/**
 * Caso 12 de docs/03-OPERACAO.md §6: a pessoa responde dias depois. O atendente
 * precisa achar quem já abordou sem mexer na fila — e, desde que os desfechos
 * passaram de cinco para onze, precisa achar POR DESFECHO.
 */
export default async function MeusContatos({
  params, searchParams,
}: {
  params: Promise<{ entrada: string }>;
  searchParams: Promise<Busca>;
}) {
  const { entrada } = await params;
  const q = await searchParams;
  await exigirAtendente(entrada);
  const supabase = await criarClienteServidor();

  const status: StatusContato | 'todos' = ehStatus(q.status) ? q.status : 'todos';
  const busca = q.busca ?? '';
  const pagina = Math.max(0, Number(q.pagina ?? 0) || 0);

  const { data } = await supabase.rpc('meus_contatos', {
    p_status: status,
    p_busca: busca || null,
    p_pagina: pagina,
    p_por_pagina: POR_PAGINA,
  });

  const dados = (data ?? {}) as Partial<RespostaMeusContatos>;

  return (
    <>
      <Titulo sub="Quem você já abordou. Clique para ver o histórico, corrigir o resultado, mandar outra mensagem ou anotar um pedido de kit.">
        Meus contatos
      </Titulo>

      <ListaMeusContatos
        dados={{
          contagens: dados.contagens ?? {},
          todos: dados.todos ?? 0,
          total: dados.total ?? 0,
          linhas: dados.linhas ?? [],
        }}
        status={status}
        busca={busca}
        pagina={pagina}
        porPagina={POR_PAGINA}
        entrada={entrada}
      />
    </>
  );
}
