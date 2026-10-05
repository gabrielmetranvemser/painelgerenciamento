'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { revalidarInterno } from '@/lib/revalidar';
import { gerarCodigo, hashDoCodigo } from '@/lib/aparelho';
import { aparelhoDesteNavegador } from '@/lib/aparelho-servidor';

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
 * ⚠️ Só liga a partir de um navegador LIBERADO — este, o de quem está ligando.
 *
 * Antes a conta era "existe algum aparelho liberado?", e ela deixou o gestor
 * trancado do lado de fora em 04/10: o único aparelho liberado era o robô de
 * pré-visualização do WhatsApp, que tinha aberto o convite antes dele. Contar
 * aparelhos não diz nada sobre quem está prestes a ser barrado; a pergunta
 * certa é se ESTE navegador passa pelo portão depois que a trava ligar.
 */
export async function alternarTravaAparelho(ligar: boolean): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  if (ligar && !(await aparelhoDesteNavegador())) {
    return {
      ok: false,
      erro: 'Este navegador ainda não está liberado. Gere um link para você, abra-o '
        + 'AQUI e toque em "Liberar este aparelho" — só então ligue a trava. Ligar agora '
        + 'trancaria você para fora do painel, inclusive desta tela.',
    };
  }

  const { error } = await supabase
    .from('config').update({ exigir_aparelho: ligar }).eq('id', 1);
  if (error) return { ok: false, erro: error.message };

  revalidarInterno('/gestor/configuracao');
  return { ok: true };
}
