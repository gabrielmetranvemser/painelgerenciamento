'use server';

import { revalidatePath } from 'next/cache';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { podeSalvar, validarModelo } from '@/lib/mensagem';
import type { EtapaMsg } from '@/lib/tipos-banco';

export type ResultadoSalvar = { ok: true } | { ok: false; erro: string };

/**
 * Salva uma variação, revalidando os blocos travados NO SERVIDOR.
 *
 * A tela já valida enquanto o gestor digita, mas a decisão é aqui: Server Action
 * é um endpoint HTTP, e as travas de texto (candidato+cargo na mesma frase, a
 * menção ao apoiador, a frase de parar/apagar, sem link e sem emoji na
 * Permissão) são o que sustenta a posição jurídica da campanha.
 */
export async function salvarVariacao(
  variacaoId: string,
  etapa: EtapaMsg,
  texto: string,
): Promise<ResultadoSalvar> {
  await exigirGestorOuFalhar();

  const problemas = validarModelo(etapa, texto);
  if (!podeSalvar(problemas)) {
    return { ok: false, erro: problemas.find((p) => p.bloqueia)!.mensagem };
  }

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('variacoes').update({ texto }).eq('id', variacaoId);
  if (error) return { ok: false, erro: error.message };

  revalidatePath('/gestor/mensagens');
  return { ok: true };
}

export async function adicionarVariacao(modeloId: string, etapa: EtapaMsg, texto: string): Promise<ResultadoSalvar> {
  await exigirGestorOuFalhar();

  const problemas = validarModelo(etapa, texto);
  if (!podeSalvar(problemas)) {
    return { ok: false, erro: problemas.find((p) => p.bloqueia)!.mensagem };
  }

  const supabase = criarClienteAdmin();
  const { data: ultima } = await supabase
    .from('variacoes').select('ordem').eq('modelo_id', modeloId)
    .order('ordem', { ascending: false }).limit(1).maybeSingle();

  const { error } = await supabase
    .from('variacoes')
    .insert({ modelo_id: modeloId, texto, ordem: (ultima?.ordem ?? 0) + 1 });

  if (error) return { ok: false, erro: error.message };
  revalidatePath('/gestor/mensagens');
  return { ok: true };
}

export async function alternarVariacao(variacaoId: string, ativa: boolean): Promise<ResultadoSalvar> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  if (!ativa) {
    // Modelo sem nenhuma variação ativa faz preparar_mensagem falhar e o
    // atendente trava no meio do turno. Barramos antes.
    const { data: variacao } = await supabase
      .from('variacoes').select('modelo_id').eq('id', variacaoId).single();
    const { count } = await supabase
      .from('variacoes').select('id', { count: 'exact', head: true })
      .eq('modelo_id', variacao?.modelo_id ?? '').eq('ativa', true);
    if ((count ?? 0) <= 1) {
      return { ok: false, erro: 'Precisa sobrar pelo menos uma variação ativa nesta etapa.' };
    }
  }

  const { error } = await supabase.from('variacoes').update({ ativa }).eq('id', variacaoId);
  if (error) return { ok: false, erro: error.message };
  revalidatePath('/gestor/mensagens');
  return { ok: true };
}
