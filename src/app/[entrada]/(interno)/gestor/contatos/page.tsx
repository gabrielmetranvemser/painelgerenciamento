import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { BotaoLink, Titulo } from '@/components/ui';
import { rotas } from '@/lib/links-internos';
import type {
  Candidato, ContatoDoGestor, Lista, Municipio, Usuario,
} from '@/lib/tipos-banco';
import { RECORTES, TabelaContatos, type Contagens, type Filtros, type Recorte } from './tabela';

export const metadata: Metadata = { title: 'Contatos' };
export const dynamic = 'force-dynamic';

/**
 * Cem por página.
 *
 * ⚠️ A versão anterior pedia 5.000 de uma vez e filtrava no navegador. O
 * PostgREST corta em 1.000 sem avisar, então a tela dizia "mostrando os 5.000
 * mais recentes de 3.686", mostrava 1.000 — e BUSCAVA dentro desses 1.000.
 * Procurar alguém que estava na base e receber "nada com esses filtros" faz o
 * gestor concluir que a pessoa não existe. Com 30 mil contatos seria a regra,
 * não a exceção.
 *
 * Agora quem filtra, conta e pagina é o banco (`contatos_do_gestor`), e o
 * navegador recebe cem linhas de cada vez — a base pode crescer à vontade que a
 * tela abre no mesmo tempo.
 */
const POR_PAGINA = 100;

type Busca = {
  atendente?: string; recorte?: string; candidato?: string; municipio?: string;
  origem?: string; lista?: string; busca?: string; pagina?: string;
};

export default async function PaginaContatos({
  params, searchParams,
}: {
  params: Promise<{ entrada: string }>;
  searchParams: Promise<Busca>;
}) {
  const { entrada } = await params;
  const q = await searchParams;
  const supabase = await criarClienteServidor();

  // Os filtros vivem na URL, e não no estado do componente: é o que permite o
  // SERVIDOR fazer o recorte. De brinde, a tela filtrada vira um link que o
  // gestor manda para alguém — e o botão "voltar" do navegador funciona.
  const filtros: Filtros = {
    recorte: (RECORTES.some((r) => r.chave === q.recorte) ? q.recorte : 'todos') as Recorte,
    atendente: q.atendente ?? '',
    candidato: q.candidato ?? '',
    municipio: q.municipio ?? '',
    origem: q.origem ?? '',
    lista: q.lista ?? '',
    busca: q.busca ?? '',
  };
  const pagina = Math.max(0, Number(q.pagina ?? 0) || 0);

  const [{ data }, { data: atendentes }, { data: candidatos }, { data: municipios }, { data: listas }] =
    await Promise.all([
      supabase.rpc('contatos_do_gestor', {
        p_recorte: filtros.recorte,
        p_atendente: filtros.atendente || null,
        p_candidato: filtros.candidato || null,
        p_municipio: filtros.municipio ? Number(filtros.municipio) : null,
        p_origem: filtros.origem || null,
        // 'sem' não é um id: é o recorte "não veio de lista nenhuma", que são os
        // contatos de captação — quem se cadastrou sozinho.
        p_lista: filtros.lista && filtros.lista !== 'sem' ? filtros.lista : null,
        p_sem_lista: filtros.lista === 'sem',
        p_busca: filtros.busca || null,
        p_pagina: pagina,
        p_por_pagina: POR_PAGINA,
      }),
      supabase.from('usuarios').select('*').order('primeiro_nome'),
      supabase.from('candidatos').select('*').order('nome_urna'),
      supabase.from('municipios').select('*').order('nome'),
      supabase.from('listas').select('id, rotulo, origem, ativa').order('criado_em', { ascending: false }),
    ]);

  const resposta = (data ?? {}) as {
    contagens?: Contagens; total?: number; linhas?: ContatoDoGestor[];
  };

  return (
    <>
      <Titulo sub="Quem foi chamado, quem respondeu, quem ainda está pendente — e por onde cada um entrou. A busca e os filtros valem para a base inteira, não só para o que está na tela.">
        Contatos
      </Titulo>

      <TabelaContatos
        contatos={resposta.linhas ?? []}
        contagens={resposta.contagens ?? {
          todos: 0, pendentes: 0, na_fila: 0, autorizou: 0, pediu_saida: 0, kit: 0,
        }}
        total={resposta.total ?? 0}
        pagina={pagina}
        porPagina={POR_PAGINA}
        filtros={filtros}
        atendentes={(atendentes ?? []) as Usuario[]}
        candidatos={(candidatos ?? []) as Candidato[]}
        municipios={(municipios ?? []) as Municipio[]}
        listas={(listas ?? []) as Pick<Lista, 'id' | 'rotulo' | 'origem' | 'ativa'>[]}
        entrada={entrada}
      />

      <div className="mt-5">
        <BotaoLink href={rotas(entrada).exportar('contatos')} variante="neutro" tamanho="p" prefetch={false}>
          Baixar CSV com todos
        </BotaoLink>
      </div>
    </>
  );
}
