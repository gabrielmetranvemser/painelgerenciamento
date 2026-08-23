import type { Metadata } from 'next';
import Link from 'next/link';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import { Cartao, EtiquetaOrigem } from '@/components/ui';
import { formatarExibicao } from '@/lib/telefone';
import type { Contato, StatusContato } from '@/lib/tipos-banco';

export const metadata: Metadata = { title: 'Meus contatos' };

const ROTULO: Partial<Record<StatusContato, string>> = {
  em_atendimento: 'Aguardando resposta',
  autorizou: 'Autorizou',
  pediu_saida: 'Pediu saída',
  invalido: 'Número inválido',
  quer_ajudar: 'Quer ajudar',
  encaminhado: 'Encaminhado',
  sem_resposta: 'Não respondeu',
  perdido: 'Perdido (chip caiu)',
};

/**
 * Caso 12 de docs/03-OPERACAO.md §6: a pessoa responde dias depois. O atendente
 * precisa achar quem já abordou sem mexer na fila.
 */
export default async function MeusContatos() {
  const usuario = await exigirAtendente();
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from('contatos')
    .select('*')
    .eq('atendente_id', usuario.id)
    .not('primeiro_contato_em', 'is', null)
    .order('primeiro_contato_em', { ascending: false })
    .limit(300);

  const contatos = (data ?? []) as Contato[];

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Meus contatos</h1>
      <p className="mb-5 text-sm text-suave">
        Quem você já abordou. Clique para ver o histórico, corrigir o resultado,
        mandar outra mensagem ou anotar um pedido de kit.
      </p>

      {contatos.length === 0 ? (
        <Cartao className="p-8 text-center text-sm text-suave">
          Você ainda não abordou ninguém.
        </Cartao>
      ) : (
        <Cartao className="divide-y divide-borda">
          {contatos.map((c) => (
            <Link
              key={c.id}
              href={`/painel/contatos/${c.id}`}
              className="flex flex-wrap items-center gap-3 px-5 py-3 hover:bg-fundo"
            >
              <div className="mr-auto min-w-0">
                <p className="truncate font-medium">
                  {c.primeiro_nome ?? c.nome ?? <span className="text-suave">(dado apagado)</span>}
                </p>
                <p className="text-xs text-suave">
                  {c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '—'}
                  {c.primeiro_contato_em &&
                    ` · ${new Date(c.primeiro_contato_em).toLocaleDateString('pt-BR')}`}
                </p>
              </div>
              <EtiquetaOrigem origem={c.origem} />
              <span className="text-xs text-suave">{ROTULO[c.status] ?? c.status}</span>
              <span aria-hidden className="text-suave">›</span>
            </Link>
          ))}
        </Cartao>
      )}
    </>
  );
}
