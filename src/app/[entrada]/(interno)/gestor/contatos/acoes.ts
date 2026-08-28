'use server';

import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';

/**
 * Dá um encaminhamento por resolvido — ou o devolve para a fila do gestor.
 *
 * "Encaminhar" é o desfecho de quando a pessoa pede algo que a campanha não
 * pode prometer (emprego, dinheiro, uma vaga). O atendente anota o pedido em
 * uma linha e responde "o que posso é levar sua pergunta pra equipe".
 *
 * ⚠️ Até agora esse texto só chegava ao gestor pelo CSV: não havia recorte, nem
 * coluna na tela, nem contador. Na prática a promessa feita à pessoa não era
 * cumprida por ninguém — a pergunta morria no banco. Sem um jeito de marcar
 * como tratado, porém, a lista só cresceria, e lista que só cresce é lista que
 * ninguém abre depois da segunda semana.
 *
 * Vai com a SESSÃO, e não com a chave de serviço: a RPC decide pelo
 * `is_gestor()`, que depende de `auth.uid()` — nulo sob service_role.
 */
export async function marcarEncaminhamentoTratado(
  contatoId: string,
  tratado: boolean,
): Promise<{ ok: boolean; erro?: string }> {
  await exigirGestorOuFalhar();

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('marcar_encaminhamento_tratado', {
    p_contato_id: contatoId,
    p_tratado: tratado,
  });
  if (error) return { ok: false, erro: error.message };

  const r = data as { ok: boolean; motivo?: string };
  return r.ok ? { ok: true } : { ok: false, erro: r.motivo };
}
