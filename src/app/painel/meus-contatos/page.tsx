import type { Metadata } from 'next';
import Link from 'next/link';
import { ChevronRight, Inbox } from 'lucide-react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import { Avatar, Cartao, EtiquetaOrigem, Pilula, Titulo, Vazio } from '@/components/ui';
import { formatarExibicao } from '@/lib/telefone';
import type { Contato, StatusContato } from '@/lib/tipos-banco';

export const metadata: Metadata = { title: 'Meus contatos' };
export const dynamic = 'force-dynamic';

const ROTULO: Partial<Record<StatusContato, { texto: string; cor: 'neutro' | 'acento' | 'alerta' | 'perigo' }>> = {
  em_atendimento: { texto: 'Aguardando resposta', cor: 'neutro' },
  autorizou: { texto: 'Autorizou', cor: 'acento' },
  pediu_saida: { texto: 'Pediu saída', cor: 'perigo' },
  invalido: { texto: 'Número inválido', cor: 'neutro' },
  quer_ajudar: { texto: 'Quer ajudar', cor: 'acento' },
  encaminhado: { texto: 'Encaminhado', cor: 'alerta' },
  sem_resposta: { texto: 'Não respondeu', cor: 'neutro' },
  perdido: { texto: 'Perdido (o número caiu)', cor: 'perigo' },
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
      <Titulo sub="Quem você já abordou. Clique para ver o histórico, corrigir o resultado, mandar outra mensagem ou anotar um pedido de kit.">
        Meus contatos
      </Titulo>

      {contatos.length === 0 ? (
        <Vazio icone={<Inbox size={26} />}>
          Você ainda não abordou ninguém. Quem você atender aparece aqui.
        </Vazio>
      ) : (
        <Cartao className="divide-y divide-borda overflow-hidden">
          {contatos.map((c) => {
            const estado = ROTULO[c.status];
            return (
              <Link
                key={c.id}
                href={`/painel/contatos/${c.id}`}
                className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-superficie-alta"
              >
                <Avatar nome={c.nome ?? c.primeiro_nome} tamanho="m" />
                <div className="mr-auto min-w-0">
                  <p className="truncate font-semibold">
                    {c.primeiro_nome ?? c.nome ?? <span className="text-tenue">(dados apagados)</span>}
                  </p>
                  <p className="truncate text-xs text-suave">
                    {c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '—'}
                    {c.primeiro_contato_em &&
                      ` · ${new Date(c.primeiro_contato_em).toLocaleDateString('pt-BR')}`}
                  </p>
                </div>
                <EtiquetaOrigem origem={c.origem} />
                {estado && <Pilula cor={estado.cor}>{estado.texto}</Pilula>}
                <ChevronRight size={16} className="text-tenue" />
              </Link>
            );
          })}
        </Cartao>
      )}
    </>
  );
}
