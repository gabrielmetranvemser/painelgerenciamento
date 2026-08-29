import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import { saudacao } from '@/lib/mensagem';
import { ROTULO_CARGO, type CargoEleitoral } from '@/lib/tipos-banco';
import { Roteiro } from './roteiro';

export const metadata: Metadata = { title: 'Roteiro da conversa' };
export const dynamic = 'force-dynamic';

/**
 * O roteiro completo, em aba própria.
 *
 * ⚠️ Abre em `target="_blank"` de propósito, e não numa sanfona da lateral. O
 * atendente já trabalha com duas janelas lado a lado — o painel e o WhatsApp
 * Web (docs/03-OPERACAO.md §2). Um roteiro de quinze blocos dentro da coluna
 * estreita da direita obrigaria a rolar a tela de atendimento para ler a
 * resposta, no meio de uma conversa. Em aba separada ele fica aberto o turno
 * inteiro, do lado, sem tirar o contato da frente.
 *
 * Os nomes vêm da chapa REAL de quem abriu: o roteiro em papel fala em
 * [CANDIDATO] e [NÚMERO CANDIDATO], e quem lê no meio de uma conversa não tem
 * de traduzir isso na cabeça.
 */
export default async function PaginaScript({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const usuario = await exigirAtendente(entrada);
  const supabase = await criarClienteServidor();

  const [{ data: chapa }, { data: config }] = await Promise.all([
    supabase.rpc('chapa_do_atendente', { p_atendente: usuario.id }),
    supabase.from('config').select('timezone').eq('id', 1).single(),
  ]);

  const linhas = (chapa ?? []) as {
    candidato_id: string; nome_urna: string; cargo: CargoEleitoral;
    numero: string; partido_sigla: string | null; principal: boolean;
  }[];

  // O principal é o citado na primeira mensagem; sem principal, o primeiro da
  // ordem de leitura, que é a mesma que a permissão declara.
  const escolhido = linhas.find((c) => c.principal) ?? linhas[0] ?? null;
  const fuso = config?.timezone ?? 'America/Porto_Velho';

  return (
    <Roteiro
      primeiroNome={usuario.primeiro_nome}
      dados={{
        candidato: escolhido?.nome_urna ?? null,
        cargo: escolhido ? ROTULO_CARGO[escolhido.cargo].toLocaleLowerCase('pt-BR') : null,
        numero: escolhido?.numero ?? null,
        saudacao: saudacao(new Date(), fuso),
      }}
      chapa={linhas.map((c) => ({
        nome: c.nome_urna,
        cargo: ROTULO_CARGO[c.cargo].toLocaleLowerCase('pt-BR'),
        numero: c.numero,
      }))}
    />
  );
}
