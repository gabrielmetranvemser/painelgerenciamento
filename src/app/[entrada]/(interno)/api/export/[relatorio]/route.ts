import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { ehChaveDoPainel } from '@/lib/rotas';
import type { OrigemContato, StatusContato } from '@/lib/tipos-banco';
import { dataHoraLocal, gerarCsv, type Coluna } from '@/lib/csv';
import { formatarCep } from '@/lib/cep';
import { formatarExibicao } from '@/lib/telefone';

export const dynamic = 'force-dynamic';

/**
 * ⚠️ Os dois mapas são `Record<Tipo, string>`, não `Record<string, string>`.
 *
 * Com `string` na chave, o TypeScript aceita um mapa incompleto — e foi assim
 * que a origem 'chamou' entrou no sistema e nunca chegou aqui: a planilha do
 * gestor mostrava `chamou` cru, no meio de rótulos em português, e nada quebrou
 * para avisar. Tipado pelo enum, esquecer um valor novo vira erro de build.
 */
const ROTULO_STATUS: Record<StatusContato, string> = {
  novo: 'Novo', na_fila: 'Na fila', em_atendimento: 'Em atendimento',
  autorizou: 'Autorizou', pediu_saida: 'Pediu saída', invalido: 'Número inválido',
  quer_ajudar: 'Quer ajudar', encaminhado: 'Encaminhado',
  sem_resposta: 'Sem resposta', perdido: 'Perdido',
};

const ROTULO_ORIGEM: Record<OrigemContato, string> = {
  site: 'Cadastro no site', kit: 'Pedido de kit', lista_fria: 'Lista fria',
  chamou: 'Chamou no WhatsApp',
};

/**
 * Exportações do gestor.
 *
 * ⚠️ Contém dado pessoal. Só gestor, e é por isso que a checagem de papel
 * acontece aqui e não só na navegação.
 *
 * ⚠️ E a checagem do segmento secreto TAMBÉM acontece aqui, pelo mesmo motivo:
 * Route Handler NÃO executa layout. O `notFound()` de `(interno)/layout.tsx`,
 * que protege todas as telas, simplesmente não roda para esta rota — então
 * `/qualquer-coisa/api/export/contatos` respondia `401 {"erro":"sem sessão"}`
 * em vez de 404. Não vazava dado nenhum, mas confirmava a quem estivesse
 * varrendo o domínio que existe um painel ali, que é exatamente o que o
 * segmento secreto existe para não fazer.
 *
 * Toda recusa devolve 404, igual a qualquer endereço inexistente: de fora,
 * "não existe", "existe mas você não entrou" e "existe mas você não é gestor"
 * precisam ser a mesma coisa.
 */
export async function GET(
  _request: NextRequest,
  ctx: { params: Promise<{ entrada: string; relatorio: string }> },
) {
  const { entrada, relatorio } = await ctx.params;
  if (!ehChaveDoPainel(entrada)) return naoEncontrado();

  const supabaseSessao = await criarClienteServidor();
  const { data: { user } } = await supabaseSessao.auth.getUser();
  if (!user) return naoEncontrado();

  const { data: perfil } = await supabaseSessao
    .from('usuarios').select('papel, ativo').eq('id', user.id).maybeSingle();
  if (!perfil?.ativo || perfil.papel !== 'gestor') return naoEncontrado();

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
        { cabecalho: 'Origem', valor: (c) => ROTULO_ORIGEM[c.origem as OrigemContato] ?? c.origem },
        { cabecalho: 'Situação', valor: (c) => ROTULO_STATUS[c.status as StatusContato] ?? c.status },
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
      // O que a equipe de entrega precisa levar na rua, com o que já saiu.
      //
      // O filtro é `itens is not null`, não `origem = 'kit'`: o pedido também
      // nasce do bloco que o atendente preenche durante a conversa, e ali a
      // origem do contato continua sendo a de onde ele veio.
      const { data } = await supabase
        .from('v_entregas')
        .select('*')
        .order('pedido_em', { ascending: true });

      type L = {
        nome: string | null; telefone_e164: string | null; endereco: string | null;
        cep: string | null; rua: string | null; numero: string | null; bairro: string | null;
        tamanho_camiseta: string | null;
        itens: string[] | null; pedido_em: string; municipio: string | null;
        candidato: string | null; atendente: string | null; estado: string;
        entregue_em: string | null; entregue_por: string | null;
        cancelado_em: string | null; entrega_obs: string | null;
        status_contato: string | null;
      };

      csv = gerarCsv((data ?? []) as unknown as L[], [
        { cabecalho: 'Situação', valor: (c) => c.estado },
        { cabecalho: 'Nome', valor: (c) => c.nome },
        { cabecalho: 'Telefone', valor: (c) => (c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '') },
        { cabecalho: 'Município', valor: (c) => c.municipio },
        // Bairro logo depois do município: quem monta a rota ordena por ele, e
        // numa planilha isso quer dizer que as duas colunas ficam lado a lado.
        { cabecalho: 'Bairro', valor: (c) => c.bairro },
        { cabecalho: 'Rua', valor: (c) => c.rua },
        { cabecalho: 'Número', valor: (c) => c.numero },
        { cabecalho: 'CEP', valor: (c) => (c.cep ? formatarCep(c.cep) : '') },
        // A linha inteira continua saindo: é o único endereço que existe nos
        // pedidos anteriores a esta versão, quando o campo era texto livre.
        { cabecalho: 'Endereço', valor: (c) => c.endereco },
        { cabecalho: 'Itens', valor: (c) => (c.itens ?? []).join(', ') },
        { cabecalho: 'Tamanho da camiseta', valor: (c) => c.tamanho_camiseta },
        { cabecalho: 'Candidato', valor: (c) => c.candidato },
        { cabecalho: 'Atendente', valor: (c) => c.atendente },
        { cabecalho: 'Pedido em', valor: (c) => q(c.pedido_em) },
        { cabecalho: 'Entregue em', valor: (c) => q(c.entregue_em) },
        { cabecalho: 'Entregue por', valor: (c) => c.entregue_por },
        { cabecalho: 'Cancelado em', valor: (c) => q(c.cancelado_em) },
        { cabecalho: 'Observação', valor: (c) => c.entrega_obs },
        // Quem pediu material e depois pediu para sair NÃO recebe visita.
        { cabecalho: 'Atenção', valor: (c) => (c.status_contato === 'pediu_saida' ? 'PEDIU SAÍDA — não entregar' : '') },
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
      return naoEncontrado();
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

function naoEncontrado() {
  return new NextResponse('Página não encontrada.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
