import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { Aviso, Titulo } from '@/components/ui';
import { rotas } from '@/lib/links-internos';
import { periodoEscolhido, type RelatorioDeAtendimento } from '@/lib/desempenho';
import { PainelDeDesempenho } from './painel';

export const metadata: Metadata = { title: 'Desempenho' };
export const dynamic = 'force-dynamic';

/**
 * Quem busca fica aqui; quem desenha fica em `painel.tsx`.
 *
 * A separação não é organização por organização: é ela que permite montar a
 * tela inteira com dados reais fora de uma requisição, e portanto conferir o
 * desenho sem estar logado no painel.
 */
export default async function PaginaDesempenho({
  params, searchParams,
}: {
  params: Promise<{ entrada: string }>;
  searchParams: Promise<{ dias?: string; atendente?: string }>;
}) {
  const { entrada } = await params;
  const q = await searchParams;
  const rt = rotas(entrada);
  const supabase = await criarClienteServidor();

  // O recorte vive na URL, e não no estado de um componente: assim quem soma é
  // o SERVIDOR, a tela filtrada vira um link que o gestor manda para alguém, e
  // o botão "voltar" do navegador funciona. Mesma decisão da tela de Contatos.
  const dias = periodoEscolhido(q.dias);
  const escolhido = q.atendente || '';

  const [{ data, error }, { data: config }] = await Promise.all([
    supabase.rpc('relatorio_de_atendimento', {
      p_dias: dias,
      p_atendente: escolhido || null,
    }),
    supabase.from('config').select('hora_inicio, hora_fim').eq('id', 1).maybeSingle(),
  ]);

  const relatorio = data as RelatorioDeAtendimento | { erro: string } | null;

  if (!relatorio || 'erro' in relatorio || error) {
    return (
      <>
        <Titulo>Desempenho por atendente</Titulo>
        <Aviso tom="erro">
          Não consegui montar o relatório{error ? `: ${error.message}` : '.'}
        </Aviso>
      </>
    );
  }

  return (
    <PainelDeDesempenho
      relatorio={relatorio}
      config={config as { hora_inicio: number; hora_fim: number } | null}
      dias={dias}
      escolhido={escolhido}
      rt={rt}
    />
  );
}
