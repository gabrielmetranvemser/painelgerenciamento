import type { Metadata } from 'next';
import Link from 'next/link';
import { rotas } from '@/lib/links-internos';
import { criarClienteServidor } from '@/lib/supabase/server';
import { Aviso, Titulo } from '@/components/ui';
import { ROTULO_CARGO, type Candidato, type EtapaMsg, type Modelo, type Variacao } from '@/lib/tipos-banco';
import { EditorMensagens } from './editor';

export const metadata: Metadata = { title: 'Mensagens' };
export const dynamic = 'force-dynamic';

const ORDEM: EtapaMsg[] = [
  'permissao', 'material', 'saida', 'quem_passou',
  'quer_ajudar', 'encaminhamento', 'convite_grupo',
];

export default async function PaginaMensagens({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const supabase = await criarClienteServidor();

  const [{ data: modelos }, { data: variacoes }, { data: cfg }, { data: candidatos }] =
    await Promise.all([
      supabase.from('modelos').select('*'),
      supabase.from('variacoes').select('*').order('ordem'),
      supabase.from('config').select('timezone').eq('id', 1).single(),
      // A prévia usa candidatos DE VERDADE. Com nome inventado o gestor não
      // enxerga o texto que a pessoa vai receber — e é justamente o tamanho da
      // lista de nomes que faz a Permissão passar ou estourar as quatro linhas.
      supabase.from('candidatos').select('*').eq('ativo', true).limit(5),
    ]);

  const agrupados = (modelos ?? [])
    .map((m) => ({
      ...(m as Modelo),
      variacoes: ((variacoes ?? []) as Variacao[]).filter((v) => v.modelo_id === m.id),
    }))
    .sort((a, b) => ORDEM.indexOf(a.etapa) - ORDEM.indexOf(b.etapa));

  const lista = (candidatos ?? []) as Candidato[];
  const primeiro = lista[0] ?? null;

  return (
    <>
      <Titulo sub="Você edita os textos sem depender do desenvolvedor. Algumas partes são obrigatórias e o sistema não deixa salvar sem elas.">Mensagens</Titulo>

      {lista.length === 0 && (
        <Aviso tom="alerta" className="mb-5">
          Nenhum candidato cadastrado ainda. Cadastre em{' '}
          <Link href={rotas(entrada).gestorCandidatos} className="underline underline-offset-4">
            Candidatos
          </Link>{' '}
          — sem isso a prévia sai com lacunas e as mensagens também.
        </Aviso>
      )}

      <EditorMensagens
        modelos={agrupados}
        exemplo={{
          candidato: primeiro?.nome_urna ?? '',
          cargo: primeiro?.cargo ?? '',
          numero: primeiro?.numero ?? '',
          partido: primeiro?.partido_sigla ?? '',
          cnpj: primeiro?.cnpj_campanha ?? '',
          chapa: lista.map((c) => ({
            nome: c.nome_urna,
            cargo: ROTULO_CARGO[c.cargo],
            numero: c.numero,
            partido: c.partido_sigla,
          })),
          timezone: cfg?.timezone ?? 'America/Porto_Velho',
        }}
      />
    </>
  );
}
