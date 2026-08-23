import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { BotaoLink, Titulo } from '@/components/ui';
import { rotas } from '@/lib/links-internos';
import type {
  Candidato, ContatoDoGestor, Municipio, Usuario,
} from '@/lib/tipos-banco';
import { TabelaContatos } from './tabela';

export const metadata: Metadata = { title: 'Contatos' };
export const dynamic = 'force-dynamic';

/**
 * A lista de todo mundo, com o estado de cada um.
 *
 * O limite de 5.000 é deliberado: a base tem ~10 mil e mandar tudo para o
 * navegador travaria a máquina do gestor. Quem precisa da base inteira baixa o
 * CSV — que é o botão logo abaixo, e não uma promessa vazia.
 */
const LIMITE = 5000;

export default async function PaginaContatos({
  params, searchParams,
}: {
  params: Promise<{ entrada: string }>;
  searchParams: Promise<{ atendente?: string; recorte?: string }>;
}) {
  const { entrada } = await params;
  // Relatórios → "ver contatos" cai aqui já filtrado pelo atendente.
  const { atendente, recorte } = await searchParams;
  const supabase = await criarClienteServidor();

  const [{ data: contatos, count }, { data: atendentes }, { data: candidatos }, { data: municipios }] =
    await Promise.all([
      supabase
        .from('v_contatos_gestor')
        .select('*', { count: 'exact' })
        .order('criado_em', { ascending: false })
        .limit(LIMITE),
      supabase.from('usuarios').select('*').order('primeiro_nome'),
      supabase.from('candidatos').select('*').order('nome_urna'),
      supabase.from('municipios').select('*').order('nome'),
    ]);

  const lista = (contatos ?? []) as ContatoDoGestor[];

  return (
    <>
      <Titulo
        sub={
          (count ?? 0) > LIMITE
            ? `Mostrando os ${LIMITE.toLocaleString('pt-BR')} mais recentes de ${(count ?? 0).toLocaleString('pt-BR')}. Para a base inteira, baixe o CSV.`
            : 'Quem foi chamado, quem respondeu, quem ainda está pendente — e por onde cada um entrou.'
        }
      >
        Contatos
      </Titulo>

      <TabelaContatos
        contatos={lista}
        atendentes={(atendentes ?? []) as Usuario[]}
        candidatos={(candidatos ?? []) as Candidato[]}
        municipios={(municipios ?? []) as Municipio[]}
        entrada={entrada}
        atendenteInicial={atendente ?? ''}
        recorteInicial={recorte === 'pendentes' ? 'pendentes' : 'todos'}
      />

      <div className="mt-5">
        <BotaoLink href={rotas(entrada).exportar('contatos')} variante="neutro" tamanho="p" prefetch={false}>
          Baixar CSV com todos
        </BotaoLink>
      </div>
    </>
  );
}
