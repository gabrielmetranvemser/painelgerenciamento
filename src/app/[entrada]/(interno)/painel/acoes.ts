'use server';

import { criarClienteServidor } from '@/lib/supabase/server';
import { montarTexto, primeiroNomeDe } from '@/lib/mensagem-etapas';
import { urlWhatsApp } from '@/lib/telefone';
import type {
  CargoEleitoral, EntregaDoContato, EtapaMsg, FilaStatus, OrigemContato,
  RespostaAbertura, RespostaFila, RespostaResultado, Resultado,
} from '@/lib/tipos-banco';

export type MensagemPronta = {
  ok: true;
  etapa: EtapaMsg;
  variacaoId: string;
  texto: string;
  urlWhatsApp: string;
  /** O candidato desta mensagem, quando ela é de um só. */
  candidato: { id: string; nome: string; cargo: string } | null;
};
export type MensagemErro = { ok: false; motivo: string };

export type CandidatoDaChapa = {
  id: string;
  nome: string;
  cargo: CargoEleitoral;
  numero: string;
  partido: string | null;
  principal: boolean;
};

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

type RespostaPreparar = {
  ok: boolean;
  motivo?: string;
  modelo: string;
  variacao_id: string;
  contato: {
    primeiro_nome: string | null; nome: string | null; telefone_e164: string;
    origem: OrigemContato;
  };
  atendente_nome: string;
  timezone: string;
  municipio: string | null;
  chapa: CandidatoDaChapa[];
  candidato: {
    id: string; nome: string; cargo: string; numero: string;
    partido: string | null; cnpj: string | null;
  } | null;
  materiais: { titulo: string; tipo: string; token: string }[];
  /** Token da página de material daquele candidato. Alimenta {{link}}. */
  pagina_token: string | null;
};

/**
 * Monta o texto de uma etapa.
 *
 * O banco devolve o MODELO com as variáveis; a substituição acontece aqui, com
 * a mesma função que src/lib/mensagem.test.ts cobre. O texto nunca é montado no
 * navegador: o cliente não deve conseguir alterar o que o sistema considera
 * "a mensagem oficial" antes de ela ir para o log de auditoria.
 *
 * `candidatoId` é obrigatório nas etapas de candidato (material e convite). O
 * servidor recusa se aquele candidato não foi declarado na permissão daquele
 * contato — é a trava do escopo do consentimento.
 */
export async function prepararMensagem(
  contatoId: string,
  chipId: string,
  etapa: EtapaMsg,
  candidatoId?: string | null,
): Promise<MensagemPronta | MensagemErro> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('preparar_mensagem', {
    p_contato_id: contatoId,
    p_chip_id: chipId,
    p_etapa: etapa,
    p_candidato_id: candidatoId ?? null,
  });
  if (error) throw new Error(error.message);

  const r = data as RespostaPreparar;
  if (!r.ok) return { ok: false, motivo: r.motivo ?? 'erro' };

  const base = process.env.LINK_BASE_URL ?? '';
  const texto = montarTexto(r.modelo, {
    primeiroNome: r.contato.primeiro_nome ?? primeiroNomeDe(r.contato.nome),
    nomeAtendente: r.atendente_nome,
    // Decide a frase de {{origem}}: quem veio da lista foi indicado por um
    // apoiador; quem veio do site pediu o material sozinho.
    origemContato: r.contato.origem,
    chapa: r.chapa.map((c) => ({
      nome: c.nome, cargo: c.cargo, numero: c.numero, partido: c.partido,
    })),
    candidato: r.candidato?.nome ?? null,
    cargo: r.candidato?.cargo ?? null,
    numero: r.candidato?.numero ?? null,
    partido: r.candidato?.partido ?? null,
    cnpj: r.candidato?.cnpj ?? null,
    materiais: r.materiais.map((m) => ({ titulo: m.titulo, url: `${base}/r/${m.token}` })),
    // {{link}} é a PÁGINA do candidato, não a primeira peça: é ela que carrega
    // a identificação da propaganda e o botão de sair.
    link: r.pagina_token ? `${base}/r/${r.pagina_token}` : null,
    municipio: r.municipio,
    agora: new Date(),
    timezone: r.timezone,
  });

  return {
    ok: true,
    etapa,
    variacaoId: r.variacao_id,
    texto,
    urlWhatsApp: urlWhatsApp(r.contato.telefone_e164, texto),
    candidato: r.candidato
      ? { id: r.candidato.id, nome: r.candidato.nome, cargo: r.candidato.cargo }
      : null,
  };
}

/** A chapa do atendente, para a tela oferecer um botão de material por candidato. */
export async function carregarChapa(): Promise<CandidatoDaChapa[]> {
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return [];

  const { data, error } = await supabase.rpc('chapa_do_atendente', { p_atendente: user.id });
  if (error) throw new Error(error.message);

  return ((data ?? []) as {
    candidato_id: string; nome_urna: string; cargo: CargoEleitoral;
    numero: string; partido_sigla: string | null; principal: boolean;
  }[]).map((c) => ({
    id: c.candidato_id, nome: c.nome_urna, cargo: c.cargo,
    numero: c.numero, partido: c.partido_sigla, principal: c.principal,
  }));
}

/**
 * Os candidatos que ESTE contato conhece, com o que falta entregar a cada um.
 *
 * Não é a chapa do atendente: é a lista congelada quando a permissão foi
 * enviada. Um candidato que entrou na chapa depois não aparece aqui, e é por
 * isso que a tela não oferece um botão que o servidor recusaria.
 */
export async function carregarEntregas(contatoId: string): Promise<EntregaDoContato[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('candidatos_do_contato', {
    p_contato_id: contatoId,
  });
  if (error) throw new Error(error.message);
  return (data ?? []) as EntregaDoContato[];
}

/** Marca que a conversa foi aberta. Idempotente: duplo clique não conta 2x. */
export async function registrarAbertura(
  contatoId: string,
  chipId: string,
  etapa: EtapaMsg,
  texto: string,
  variacaoId: string,
  candidatoId?: string | null,
): Promise<RespostaAbertura> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('registrar_abertura', {
    p_contato_id: contatoId,
    p_chip_id: chipId,
    p_etapa: etapa,
    p_texto: texto,
    p_variacao_id: variacaoId,
    p_candidato_id: candidatoId ?? null,
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
