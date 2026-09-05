'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { revalidarInterno } from '@/lib/revalidar';
import { gerarCodigo, hashDoCodigo } from '@/lib/aparelho';

export type Resultado = { ok: true } | { ok: false; erro: string };

/**
 * Gera o convite e devolve o LINK — uma vez só.
 *
 * ⚠️ O código em claro nunca é gravado: o banco guarda só o hash. Isso quer
 * dizer que este link não pode ser consultado depois, nem por quem tem acesso
 * ao banco. Se o gestor fechar a tela sem copiar, gera outro — é de graça.
 *
 * É esse o motivo de o link aparecer aqui e não numa listagem: um link de
 * liberação guardado em algum lugar é um link que um dia vaza.
 */
export async function gerarConviteAparelho(
  usuarioId: string,
  rotulo: string,
  origem: string,
): Promise<{ ok: true; link: string } | { ok: false; erro: string }> {
  await exigirGestorOuFalhar();

  if (rotulo.trim().length < 2) {
    return { ok: false, erro: 'Diga de qual aparelho é (ex.: "Notebook da Laura").' };
  }

  const codigo = gerarCodigo();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('criar_convite_aparelho', {
    p_usuario_id: usuarioId,
    p_rotulo: rotulo.trim(),
    p_codigo_hash: await hashDoCodigo(codigo),
    p_horas: 48,
  });

  if (error) return { ok: false, erro: error.message };
  const r = data as { ok: boolean; motivo?: string } | null;
  if (!r?.ok) return { ok: false, erro: r?.motivo ?? 'Não consegui gerar.' };

  revalidarInterno('/gestor/configuracao');
  return { ok: true, link: `${origem}/a/${codigo}` };
}

/**
 * Tira um aparelho do ar.
 *
 * Não apaga a linha: o histórico de quem entrou de onde é o que responde
 * "desde quando esse aparelho tinha acesso?" se algum dia a pergunta aparecer.
 */
export async function revogarAparelho(id: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('revogar_aparelho', { p_id: id });
  if (error) return { ok: false, erro: error.message };
  const r = data as { ok: boolean; motivo?: string } | null;
  if (!r?.ok) return { ok: false, erro: r?.motivo ?? 'Não consegui revogar.' };
  revalidarInterno('/gestor/configuracao');
  return { ok: true };
}

/**
 * Liga e desliga a trava.
 *
 * ⚠️ Ligar com nenhum aparelho liberado trancaria o próprio gestor para fora —
 * inclusive desta tela. Por isso a ação recusa: quem opera precisa ter liberado
 * o aparelho dele antes, e ter conferido que entra.
 */
export async function alternarTravaAparelho(ligar: boolean): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  if (ligar) {
    const { count } = await supabase
      .from('aparelhos')
      .select('id', { count: 'exact', head: true })
      .not('liberado_em', 'is', null)
      .is('revogado_em', null);

    if ((count ?? 0) === 0) {
      return {
        ok: false,
        erro: 'Libere pelo menos um aparelho antes — o seu. Ligar agora trancaria '
          + 'você para fora do painel, inclusive desta tela.',
      };
    }
  }

  const { error } = await supabase
    .from('config').update({ exigir_aparelho: ligar }).eq('id', 1);
  if (error) return { ok: false, erro: error.message };

  revalidarInterno('/gestor/configuracao');
  return { ok: true };
}
