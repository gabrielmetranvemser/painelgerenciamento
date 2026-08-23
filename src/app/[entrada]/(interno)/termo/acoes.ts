'use server';

import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';

const MOTIVO: Record<string, string> = {
  sem_sessao: 'Sua sessão expirou. Entre de novo e aceite o termo.',
  usuario_inativo:
    'Sua conta está inativa, então o aceite não foi gravado. Fale com o gestor antes de começar.',
};

/**
 * Grava o aceite com data e hora. Sem aceite, `fila_status` recusa entregar
 * contato — a trava está no servidor, não só nesta tela.
 *
 * ⚠️ Passa por RPC, e não por `update` direto, por um motivo que custou caro:
 * atendente não tem policy de UPDATE em `usuarios`. Um `update` dele não dá
 * erro — acerta zero linhas e volta com sucesso. A tela mandava para o painel,
 * o painel via que não havia aceite e mandava de volta, e o atendente ficava
 * aceitando em círculo. Ver 20260823290000_aceitar_termo.sql.
 */
export async function aceitarTermo(entrada: string): Promise<string | null> {
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect(`/${entrada}/entrar`);

  const { data, error } = await supabase.rpc('aceitar_termo');
  if (error) return `Não consegui gravar o aceite: ${error.message}`;

  const r = data as { ok: boolean; motivo?: string };
  if (!r?.ok) return MOTIVO[r?.motivo ?? ''] ?? 'Não consegui gravar o aceite. Tente de novo.';

  redirect(`/${entrada}/painel`);
}
