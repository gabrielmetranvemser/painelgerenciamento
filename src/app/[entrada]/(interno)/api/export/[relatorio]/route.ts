import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { dataHoraLocal, gerarCsv, type Coluna } from '@/lib/csv';
import { formatarExibicao } from '@/lib/telefone';

export const dynamic = 'force-dynamic';

const ROTULO_STATUS: Record<string, string> = {
  novo: 'Novo', na_fila: 'Na fila', em_atendimento: 'Em atendimento',
  autorizou: 'Autorizou', pediu_saida: 'Pediu saída', invalido: 'Número inválido',
  quer_ajudar: 'Quer ajudar', encaminhado: 'Encaminhado',
  sem_resposta: 'Sem resposta', perdido: 'Perdido',
};

const ROTULO_ORIGEM: Record<string, string> = {
  site: 'Cadastro no site', kit: 'Pedido de kit', lista_fria: 'Lista fria',
};

/**
 * Exportações do gestor.
 *
 * ⚠️ Contém dado pessoal. Só gestor, e é por isso que a checagem de papel
 * acontece aqui e não só na navegação.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ relatorio: string }> },
) {
  const supabaseSessao = await criarClienteServidor();
  const { data: { user } } = await supabaseSessao.auth.getUser();
  if (!user) return NextResponse.json({ erro: 'sem sessão' }, { status: 401 });

  const { data: perfil } = await supabaseSessao
    .from('usuarios').select('papel, ativo').eq('id', user.id).single();
  if (!perfil?.ativo || perfil.papel !== 'gestor') {
    return NextResponse.json({ erro: 'restrito ao gestor' }, { status: 403 });
  }

  const { relatorio } = await ctx.params;
  const supabase = criarClienteAdmin();

  const { data: cfg } = await supabase.from('config').select('timezone').eq('id', 1).single();
  const tz = cfg?.timezone ?? 'America/Porto_Velho';
  const q = (iso: string | null) => dataHoraLocal(iso, tz);

  let csv: string;
  let nome: string;

  switch (relatorio) {
    case 'contatos': {
      const { data } = await supabase
        .from('contatos')
        .select('*, municipios(nome), usuarios(primeiro_nome), listas(rotulo)')
        .order('criado_em', { ascending: false })
        .limit(50000);

      type L = Record<string, never> & {
        nome: string | null; telefone_e164: string | null; origem: string; status: string;
        primeiro_contato_em: string | null; resultado_em: string | null; encaminhamento: string | null;
        criado_em: string; anonimizado_em: string | null;
        municipios: { nome: string } | null;
        usuarios: { primeiro_nome: string } | null;
        listas: { rotulo: string } | null;
      };

      const colunas: Coluna<L>[] = [
        { cabecalho: 'Nome', valor: (c) => c.nome },
        { cabecalho: 'Telefone', valor: (c) => (c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '') },
        { cabecalho: 'Município', valor: (c) => c.municipios?.nome },
        { cabecalho: 'Origem', valor: (c) => ROTULO_ORIGEM[c.origem] ?? c.origem },
        { cabecalho: 'Situação', valor: (c) => ROTULO_STATUS[c.status] ?? c.status },
        { cabecalho: 'Atendente', valor: (c) => c.usuarios?.primeiro_nome },
        { cabecalho: 'Lista', valor: (c) => c.listas?.rotulo },
        { cabecalho: 'Primeiro contato', valor: (c) => q(c.primeiro_contato_em) },
        { cabecalho: 'Resultado em', valor: (c) => q(c.resultado_em) },
        { cabecalho: 'Encaminhamento', valor: (c) => c.encaminhamento },
        { cabecalho: 'Importado em', valor: (c) => q(c.criado_em) },
        { cabecalho: 'Dados apagados em', valor: (c) => q(c.anonimizado_em) },
      ];
      csv = gerarCsv((data ?? []) as unknown as L[], colunas);
      nome = 'contatos';
      break;
    }

    case 'kit': {
      // O que a equipe de entrega precisa levar na rua.
      const { data } = await supabase
        .from('captacoes')
        .select('*, municipios(nome)')
        .eq('origem', 'kit')
        .order('criado_em', { ascending: false });

      type L = {
        nome: string | null; telefone_e164: string | null; endereco: string | null;
        itens: string[] | null; aceite_em: string; virou_contato: boolean;
        municipios: { nome: string } | null;
      };

      csv = gerarCsv((data ?? []) as unknown as L[], [
        { cabecalho: 'Nome', valor: (c) => c.nome },
        { cabecalho: 'Telefone', valor: (c) => (c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '') },
        { cabecalho: 'Município', valor: (c) => c.municipios?.nome },
        { cabecalho: 'Endereço', valor: (c) => c.endereco },
        { cabecalho: 'Itens', valor: (c) => (c.itens ?? []).join(', ') },
        { cabecalho: 'Pedido em', valor: (c) => q(c.aceite_em) },
        { cabecalho: 'Já entrou na fila', valor: (c) => (c.virou_contato ? 'sim' : 'não') },
      ]);
      nome = 'pedidos-de-kit';
      break;
    }

    case 'municipios': {
      const { data } = await supabase.from('v_funil_municipio').select('*').order('contatos', { ascending: false });
      type L = { municipio: string; contatos: number; autorizou: number; pediu_saida: number; quer_ajudar: number; cliques_reais: number };
      csv = gerarCsv((data ?? []) as L[], [
        { cabecalho: 'Município', valor: (m) => m.municipio },
        { cabecalho: 'Abordados', valor: (m) => m.contatos },
        { cabecalho: 'Autorizaram', valor: (m) => m.autorizou },
        { cabecalho: 'Pediram saída', valor: (m) => m.pediu_saida },
        { cabecalho: 'Querem ajudar', valor: (m) => m.quer_ajudar },
        { cabecalho: 'Cliques reais', valor: (m) => m.cliques_reais },
      ]);
      nome = 'por-municipio';
      break;
    }

    case 'atendentes': {
      const { data } = await supabase.from('v_desempenho_atendente').select('*').order('total_abordados', { ascending: false });
      type L = { atendente: string; ativo: boolean; hoje: number; total_abordados: number; autorizou: number; pediu_saida: number; invalido: number; quer_ajudar: number; sem_resposta: number; cliques_reais: number };
      csv = gerarCsv((data ?? []) as L[], [
        { cabecalho: 'Atendente', valor: (a) => a.atendente },
        { cabecalho: 'Ativo', valor: (a) => (a.ativo ? 'sim' : 'não') },
        { cabecalho: 'Hoje', valor: (a) => a.hoje },
        { cabecalho: 'Total abordados', valor: (a) => a.total_abordados },
        { cabecalho: 'Autorizaram', valor: (a) => a.autorizou },
        { cabecalho: 'Pediram saída', valor: (a) => a.pediu_saida },
        { cabecalho: 'Número inválido', valor: (a) => a.invalido },
        { cabecalho: 'Querem ajudar', valor: (a) => a.quer_ajudar },
        { cabecalho: 'Sem resposta', valor: (a) => a.sem_resposta },
        { cabecalho: 'Cliques reais', valor: (a) => a.cliques_reais },
      ]);
      nome = 'por-atendente';
      break;
    }

    default:
      return NextResponse.json({ erro: 'relatório desconhecido' }, { status: 404 });
  }

  const hoje = new Date().toISOString().slice(0, 10);
  return new NextResponse(csv, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${nome}-${hoje}.csv"`,
      'Cache-Control': 'no-store',
    },
  });
}
