'use server';

import { criarClienteServidor } from '@/lib/supabase/server';
import { montarTexto, primeiroNomeDe, type EtapaMensagem } from '@/lib/mensagem-etapas';
import { urlWhatsApp } from '@/lib/telefone';
import type {
  EtapaMsg, FilaStatus, RespostaAbertura, RespostaFila, RespostaResultado, Resultado,
} from '@/lib/tipos-banco';

export type MensagemPronta = {
  ok: true;
  etapa: EtapaMsg;
  variacaoId: string;
  texto: string;
  urlWhatsApp: string;
};
export type MensagemErro = { ok: false; motivo: string };

/** Pede o próximo contato. Todas as travas são revalidadas no servidor. */
export async function pegarProximo(chipId: string): Promise<RespostaFila> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('pegar_proximo_contato', { p_chip_id: chipId });
  if (error) throw new Error(error.message);
  return data as RespostaFila;
}

export async function consultarFila(chipId: string): Promise<FilaStatus> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('fila_status', { p_chip_id: chipId });
  if (error) throw new Error(error.message);
  return data as FilaStatus;
}

/**
 * Monta o texto de uma etapa para um contato.
 *
 * O banco devolve o MODELO com as variáveis; a substituição acontece aqui, com
 * a mesma função que src/lib/mensagem.test.ts cobre. O texto nunca é montado no
 * navegador: o cliente não deve conseguir alterar o que o sistema considera
 * "a mensagem oficial" antes de ela ir para o log de auditoria.
 */
export async function prepararMensagem(
  contatoId: string,
  chipId: string,
  etapa: EtapaMsg,
): Promise<MensagemPronta | MensagemErro> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('preparar_mensagem', {
    p_contato_id: contatoId,
    p_chip_id: chipId,
    p_etapa: etapa,
  });
  if (error) throw new Error(error.message);

  const r = data as {
    ok: boolean; motivo?: string; modelo: string; variacao_id: string;
    contato: { primeiro_nome: string | null; nome: string | null; telefone_e164: string };
    atendente_nome: string; candidato: string; cargo: string; numero: string;
    timezone: string; municipio: string | null;
    token_material: string | null; token_canal: string | null;
  };

  if (!r.ok) return { ok: false, motivo: r.motivo ?? 'erro' };

  const base = process.env.LINK_BASE_URL ?? '';
  const texto = montarTexto(r.modelo, {
    primeiroNome: r.contato.primeiro_nome ?? primeiroNomeDe(r.contato.nome),
    nomeAtendente: r.atendente_nome,
    candidato: r.candidato,
    cargo: r.cargo,
    numero: r.numero,
    link: r.token_material ? `${base}/r/${r.token_material}` : null,
    linkGrupo: r.token_canal ? `${base}/r/${r.token_canal}` : null,
    municipio: r.municipio,
    agora: new Date(),
    timezone: r.timezone,
  });

  return {
    ok: true,
    etapa: etapa as EtapaMensagem,
    variacaoId: r.variacao_id,
    texto,
    urlWhatsApp: urlWhatsApp(r.contato.telefone_e164, texto),
  };
}

/** Marca que a conversa foi aberta. Idempotente: duplo clique não conta 2x. */
export async function registrarAbertura(
  contatoId: string,
  chipId: string,
  etapa: EtapaMsg,
  texto: string,
  variacaoId: string,
): Promise<RespostaAbertura> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('registrar_abertura', {
    p_contato_id: contatoId,
    p_chip_id: chipId,
    p_etapa: etapa,
    p_texto: texto,
    p_variacao_id: variacaoId,
  });
  if (error) throw new Error(error.message);
  return data as RespostaAbertura;
}

export async function registrarResultado(
  contatoId: string,
  resultado: Resultado,
  municipioId?: number | null,
  encaminhamento?: string | null,
): Promise<RespostaResultado> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('registrar_resultado', {
    p_contato_id: contatoId,
    p_resultado: resultado,
    p_municipio_id: municipioId ?? null,
    p_encaminhamento: encaminhamento?.trim() || null,
  });
  if (error) throw new Error(error.message);
  return data as RespostaResultado;
}

/** Botão "Meu WhatsApp está estranho". */
export async function sinalizarChip(chipId: string, detalhe?: string) {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('sinalizar_chip', {
    p_chip_id: chipId,
    p_detalhe: detalhe ?? null,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; motivo?: string };
}

/** Grava o município que a pessoa informou na conversa. */
export async function definirMunicipio(contatoId: string, municipioId: number) {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('definir_municipio', {
    p_contato_id: contatoId,
    p_municipio_id: municipioId,
  });
  if (error) throw new Error(error.message);
  return data as { ok: boolean; motivo?: string };
}
