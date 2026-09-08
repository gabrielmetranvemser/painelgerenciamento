'use server';

import { updateTag } from 'next/cache';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { ETIQUETA_CANDIDATOS } from '@/lib/cache';
import { normalizarTelefone } from '@/lib/telefone';
import { problemaNaMensagemRecepcao, TEXTO_PROBLEMA_RECEPCAO } from '@/lib/recepcao';

export type Resultado = { ok: true } | { ok: false; erro: string };

const NUMERO_REPETIDO =
  'Esse número já está na recepção deste candidato. Para trocar o atendente, '
  + 'use o lápis na linha dele.';

type CamposDoNumero = {
  rotulo: string;
  numero_e164: string;
  atendente_id: string | null;
  peso: number;
};

/**
 * Ler o formulário é UMA função, e não duas iguais.
 *
 * Acrescentar e alterar leem os mesmos quatro campos. Escrevê-los duas vezes é
 * combinar que um dia divirjam — e a divergência apareceria como um número que
 * a alteração aceita e o cadastro recusa, ou o contrário, sem sintoma nenhum
 * até o gestor tropeçar.
 */
function lerCampos(
  form: FormData,
): { ok: true; campos: CamposDoNumero } | { ok: false; erro: string } {
  const rotulo = String(form.get('rotulo') ?? '').trim();
  if (rotulo.length < 2) return { ok: false, erro: 'Dê um nome ao número (ex.: "Vitor — Principal").' };
  if (rotulo.length > 40) return { ok: false, erro: 'Nome comprido demais — cabem 40 letras.' };

  const telefone = normalizarTelefone(String(form.get('numero') ?? ''));
  if (!telefone.valido) {
    return { ok: false, erro: 'Número inválido. Escreva com DDD, ex.: (69) 99999-0000.' };
  }

  return {
    ok: true,
    campos: {
      rotulo,
      numero_e164: telefone.e164,
      atendente_id: String(form.get('atendente_id') ?? '') || null,
      peso: Math.min(Math.max(Number(form.get('peso') ?? 1) || 1, 1), 10),
    },
  };
}

export async function acrescentarNumeroRecepcao(
  candidatoId: string,
  form: FormData,
): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const lido = lerCampos(form);
  if (!lido.ok) return lido;

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
    p_rotulo: lido.campos.rotulo,
    p_numero: lido.campos.numero_e164,
    p_atendente_id: lido.campos.atendente_id,
    p_peso: lido.campos.peso,
  });

  if (error) {
    if (error.message.includes('numeros_recepcao_uk')) {
      return { ok: false, erro: NUMERO_REPETIDO };
    }
    return { ok: false, erro: error.message };
  }

  const r = data as { ok: boolean; motivo?: string } | null;
  if (!r?.ok) return { ok: false, erro: r?.motivo ?? 'Não consegui cadastrar.' };

  updateTag(ETIQUETA_CANDIDATOS);
  return { ok: true };
}

/**
 * Trocar o dono, o nome, o número ou o peso de um número que já existe.
 *
 * ⚠️ Sem isto, o gestor que só precisava passar o número para outro atendente
 * ficava sem saída: desativar tira o número do rodízio (perde-se metade dos
 * cadastros), e cadastrar de novo esbarra no índice único — "esse número já
 * está na recepção". Os dois caminhos fechados, e o certo não existia.
 *
 * ⚠️ `sorteios` NÃO é zerado, nem quando o número muda. Zerar poria a linha na
 * frente de todas as outras no rodízio (`sorteios / peso`) e ela levaria
 * sozinha os próximos cadastros — exatamente o que `criar_numero_recepcao`
 * existe para evitar.
 *
 * ⚠️ E a troca de dono vale DAQUI PARA A FRENTE. Quem já foi levado a este
 * número continua reservado para quem era dono na hora (`contatos.reservado_para`):
 * a conversa está no WhatsApp daquela pessoa, e não migra junto com o cadastro.
 * A reserva vence sozinha, por `config.reserva_recepcao_horas`.
 */
export async function alterarNumeroRecepcao(id: string, form: FormData): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const lido = lerCampos(form);
  if (!lido.ok) return lido;

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('numeros_recepcao').update(lido.campos).eq('id', id);

  if (error) {
    if (error.message.includes('numeros_recepcao_uk')) {
      return { ok: false, erro: NUMERO_REPETIDO };
    }
    return { ok: false, erro: error.message };
  }

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
