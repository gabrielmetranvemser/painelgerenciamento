import type { Metadata } from 'next';
import { Layers, Upload } from 'lucide-react';
import { Aviso, BotaoLink, Titulo, Vazio } from '@/components/ui';
import { criarClienteServidor } from '@/lib/supabase/server';
import { rotas } from '@/lib/links-internos';
import type { ListaComContagem, Usuario } from '@/lib/tipos-banco';
import { Listas } from './listas';

export const metadata: Metadata = { title: 'Listas' };
export const dynamic = 'force-dynamic';

export default async function PaginaListas({ params }: { params: Promise<{ entrada: string }> }) {
  const { entrada } = await params;
  const r = rotas(entrada);
  const supabase = await criarClienteServidor();

  const [{ data: listas }, { data: usuarios }, { data: atribuicoes }, { data: semLista }] =
    await Promise.all([
      supabase.from('v_listas').select('*').order('criado_em', { ascending: false }),
      supabase
        .from('usuarios')
        .select('*')
        .eq('papel', 'atendente')
        .eq('ativo', true)
        .order('primeiro_nome'),
      supabase.from('atendente_listas').select('atendente_id, lista_id'),
      supabase.from('v_atendentes_sem_lista').select('primeiro_nome'),
    ]);

  // "Quem atende a lista X" — o índice que a tela usa. Montado aqui, no
  // servidor, para o componente de cliente não receber a tabela inteira.
  const porLista: Record<string, string[]> = {};
  for (const a of atribuicoes ?? []) {
    (porLista[a.lista_id] ??= []).push(a.atendente_id);
  }

  const orfaos = (semLista ?? []).map((u) => u.primeiro_nome);

  return (
    <>
      <Titulo
        sub="Cada lista tem dono. A fila só entrega um contato a quem tem aquela lista marcada — e lista marcada para duas pessoas é dividida entre elas, sem ninguém falar com a mesma pessoa duas vezes."
        acao={
          <BotaoLink href={r.gestorImportar} variante="neutro" tamanho="p">
            <Upload size={13} /> Importar lista
          </BotaoLink>
        }
      >
        Listas
      </Titulo>

      {orfaos.length > 0 && (
        <Aviso tom="alerta" className="mb-5">
          <p className="font-semibold">
            {orfaos.length === 1
              ? `${orfaos[0]} não está em nenhuma lista ativa.`
              : `${orfaos.length} atendentes não estão em nenhuma lista ativa: ${orfaos.join(', ')}.`}
          </p>
          <p className="mt-1">
            Quem não tem lista só recebe quem se cadastrou sozinho pelo site — na prática, fila
            parada. Marque as listas de cada um aqui embaixo ou na tela de Atendentes.
          </p>
        </Aviso>
      )}

      {(listas ?? []).length === 0 ? (
        <Vazio icone={<Layers size={28} />}>
          Nenhuma lista importada ainda. Suba a primeira planilha em Importar — o nome que você
          der lá é o nome que aparece aqui.
        </Vazio>
      ) : (
        <Listas
          listas={(listas ?? []) as ListaComContagem[]}
          atendentes={(usuarios ?? []) as Usuario[]}
          porLista={porLista}
        />
      )}
    </>
  );
}
