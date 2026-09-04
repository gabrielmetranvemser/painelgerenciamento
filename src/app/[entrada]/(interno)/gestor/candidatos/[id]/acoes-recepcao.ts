'use server';

import { updateTag } from 'next/cache';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { ETIQUETA_CANDIDATOS } from '@/lib/cache';
import { normalizarTelefone } from '@/lib/telefone';
import { problemaNaMensagemRecepcao, TEXTO_PROBLEMA_RECEPCAO } from '@/lib/recepcao';

export type Resultado = { ok: true } | { ok: false; erro: string };

export async function acrescentarNumeroRecepcao(
  candidatoId: string,
  form: FormData,
): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const rotulo = String(form.get('rotulo') ?? '').trim();
  if (rotulo.length < 2) return { ok: false, erro: 'Dê um nome ao número (ex.: "Vitor — Principal").' };

  const telefone = normalizarTelefone(String(form.get('numero') ?? ''));
  if (!telefone.valido) {
    return { ok: false, erro: 'Número inválido. Escreva com DDD, ex.: (69) 99999-0000.' };
  }

  const atendenteId = String(form.get('atendente_id') ?? '') || null;
  const peso = Math.min(Math.max(Number(form.get('peso') ?? 1) || 1, 1), 10);

  // ⚠️ Vai pela RPC, e não por um insert direto, porque é ela que faz o número
  // NOVO entrar empatado com quem mais recebeu. Um insert cru entraria zerado e
  // levaria sozinho todos os cadastros seguintes — ver a migration.
  //
  // E é `criarClienteServidor`, não o admin: a função confere `is_gestor()`, e
  // com a chave de serviço `auth.uid()` é nulo, então ela recusaria o próprio
  // gestor. Foi exatamente o defeito de `apagar_lista`.
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('criar_numero_recepcao', {
    p_candidato_id: candidatoId,
    p_rotulo: rotulo,
    p_numero: telefone.e164,
    p_atendente_id: atendenteId,
    p_peso: peso,
  });

  if (error) {
    if (error.message.includes('numeros_recepcao_uk')) {
      return { ok: false, erro: 'Esse número já está na recepção deste candidato.' };
    }
    return { ok: false, erro: error.message };
  }

  const r = data as { ok: boolean; motivo?: string } | null;
  if (!r?.ok) return { ok: false, erro: r?.motivo ?? 'Não consegui cadastrar.' };

  updateTag(ETIQUETA_CANDIDATOS);
  return { ok: true };
}

export async function alternarNumeroRecepcao(id: string, ativo: boolean): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('numeros_recepcao').update({ ativo }).eq('id', id);
  if (error) return { ok: false, erro: error.message };
  updateTag(ETIQUETA_CANDIDATOS);
  return { ok: true };
}

/**
 * Apagar um número NÃO desfaz nada do que já aconteceu.
 *
 * Ninguém é desreservado e nenhuma conversa some: quem já foi levado àquele
 * número continua com o contato reservado para o dono dele, e a reserva vence
 * sozinha. O que o gestor está tirando é só a participação no rodízio daqui
 * para a frente.
 */
export async function removerNumeroRecepcao(id: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('numeros_recepcao').delete().eq('id', id);
  if (error) return { ok: false, erro: error.message };
  updateTag(ETIQUETA_CANDIDATOS);
  return { ok: true };
}

export async function salvarMensagemRecepcao(
  candidatoId: string,
  texto: string,
): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const problema = problemaNaMensagemRecepcao(texto);
  if (problema) return { ok: false, erro: TEXTO_PROBLEMA_RECEPCAO[problema] };

  const supabase = criarClienteAdmin();
  const { error } = await supabase
    .from('candidatos')
    // Vazio volta a valer o padrão do código, e é assim que o gestor "reseta".
    .update({ mensagem_recepcao: texto.trim() || null })
    .eq('id', candidatoId);

  if (error) return { ok: false, erro: error.message };
  updateTag(ETIQUETA_CANDIDATOS);
  return { ok: true };
}
