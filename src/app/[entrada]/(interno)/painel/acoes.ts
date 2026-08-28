'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { enderecoBase } from '@/lib/endereco';
import { hashTelefone } from '@/lib/hmac';
import { montarTexto, primeiroNomeDe } from '@/lib/mensagem-etapas';
import { normalizarTelefone, urlWhatsApp, type MotivoInvalido } from '@/lib/telefone';
import type {
  CargoEleitoral, EntregaDoContato, EtapaMsg, FilaStatus, ListaDoAtendente, OrigemContato,
  MotivoFila, RespostaAbertura, RespostaAdicionarContato, RespostaFila, RespostaResultado,
  Resultado, StatusContato,
} from '@/lib/tipos-banco';

export type MensagemPronta = {
  ok: true;
  etapa: EtapaMsg;
  /** Nulo nas mensagens do gestor: elas não têm variação nem rotação por chip. */
  variacaoId: string | null;
  /** Qual texto do gestor, quando a etapa é `livre`. */
  modeloLivreId: string | null;
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

/**
 * Pede o próximo contato. Todas as travas são revalidadas no servidor.
 *
 * `listaId` é a lista que o atendente escolheu trabalhar; nulo mistura todas as
 * listas dele. Quem confere se aquela lista é mesmo dele é o banco — passar o
 * id daqui não autoriza nada.
 */
export async function pegarProximo(chipId: string, listaId?: string | null): Promise<RespostaFila> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('pegar_proximo_contato', {
    p_chip_id: chipId,
    p_lista_id: listaId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as RespostaFila;
}

export async function consultarFila(chipId: string, listaId?: string | null): Promise<FilaStatus> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('fila_status', {
    p_chip_id: chipId,
    p_lista_id: listaId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as FilaStatus;
}

/**
 * As listas deste atendente, com quantos contatos ainda esperam em cada uma.
 *
 * Serve às duas formas de trabalhar: no automático mostra QUAIS listas ele
 * atende (a fila mistura todas); no manual é o cardápio de onde ele escolhe
 * uma. Os números vêm do mesmo critério que a fila usa para entregar — contador
 * que promete contato e botão que não entrega é o defeito clássico daqui.
 */
export async function carregarMinhasListas(): Promise<ListaDoAtendente[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('minhas_listas');
  if (error) throw new Error(error.message);
  return (data ?? []) as ListaDoAtendente[];
}

type RespostaPreparar = {
  ok: boolean;
  motivo?: string;
  modelo: string;
  variacao_id: string | null;
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
  /** Obrigatório quando a etapa é `livre`: qual texto do gestor. */
  modeloLivreId?: string | null,
): Promise<MensagemPronta | MensagemErro> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('preparar_mensagem', {
    p_contato_id: contatoId,
    p_chip_id: chipId,
    p_etapa: etapa,
    p_candidato_id: candidatoId ?? null,
    p_modelo_livre_id: modeloLivreId ?? null,
  });
  if (error) throw new Error(error.message);

  const r = data as RespostaPreparar;
  if (!r.ok) return { ok: false, motivo: r.motivo ?? 'erro' };

  // Sem endereço não dá para montar link, e link relativo numa mensagem de
  // WhatsApp é texto morto. Falha aqui, com motivo, em vez de o atendente
  // mandar algo que a pessoa não consegue abrir.
  const base = enderecoBase();
  if (base === null && r.pagina_token) return { ok: false, motivo: 'sem_endereco' };

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

  // ⚠️ O texto é gravado AQUI, no servidor, no mesmo instante em que é montado
  // — e é este mesmo texto que vai para a tela e para a URL do WhatsApp.
  //
  // Antes ele viajava até o navegador e voltava como parâmetro de
  // `registrarAbertura`, o que punha a prova de auditoria na mão de quem tinha
  // interesse em falsificá-la. Ver a migration 20260823350100.
  await supabase.rpc('gravar_texto_preparado', {
    p_contato_id: contatoId,
    p_etapa: etapa,
    p_candidato_id: candidatoId ?? null,
    p_texto: texto,
    // Sem isto, o texto da segunda mensagem livre sobrescreveria o rascunho da
    // primeira: as duas têm a mesma etapa e o mesmo candidato nulo.
    p_modelo_livre_id: modeloLivreId ?? null,
  });

  return {
    ok: true,
    etapa,
    variacaoId: r.variacao_id,
    modeloLivreId: modeloLivreId ?? null,
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

/**
 * Marca que a conversa foi aberta. Idempotente: duplo clique não conta 2x.
 *
 * ⚠️ NÃO recebe o texto. Ele já está gravado desde `prepararMensagem`, escrito
 * pelo servidor — se esta função voltasse a aceitá-lo, o navegador voltaria a
 * poder registrar uma coisa e mandar outra. `p_texto` vai nulo de propósito: o
 * `coalesce` do banco preserva o que foi preparado.
 */
export async function registrarAbertura(
  contatoId: string,
  chipId: string,
  etapa: EtapaMsg,
  variacaoId: string | null,
  candidatoId?: string | null,
  modeloLivreId?: string | null,
): Promise<RespostaAbertura> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('registrar_abertura', {
    p_contato_id: contatoId,
    p_chip_id: chipId,
    p_etapa: etapa,
    p_texto: null,
    p_variacao_id: variacaoId,
    p_candidato_id: candidatoId ?? null,
    p_modelo_livre_id: modeloLivreId ?? null,
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

/**
 * "Buscar outro contato": solta o contato que está na mão.
 *
 * Se nada foi enviado, ele volta para a fila com um adiamento — senão seria o
 * mais antigo da fila e viria de volta no clique seguinte, para a mesma pessoa
 * que acabou de pular. Se a primeira mensagem já saiu, a conversa está viva:
 * fica em "Meus contatos" aguardando resposta e ninguém mais aborda.
 */
export async function pularContato(contatoId: string, chipId: string) {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('pular_contato', {
    p_contato_id: contatoId,
    p_chip_id: chipId,
  });
  if (error) throw new Error(error.message);
  return data as
    | { ok: true; destino: 'aguardando_resposta' | 'devolvido_a_fila'; fila?: FilaStatus }
    | { ok: false; motivo: string };
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

/**
 * Explicação de telefone recusado, na voz de quem vai ler: o atendente com a
 * conversa aberta do lado, não o gestor conferindo planilha.
 */
const EXPLICACAO_TELEFONE: Record<MotivoInvalido, string> = {
  fixo: 'Esse é um telefone fixo — não tem WhatsApp.',
  ddd_invalido: 'Esse DDD não existe. Confira o número.',
  curto: 'Faltam dígitos. Copie o número com DDD.',
  longo: 'Número com dígitos demais. Confira.',
  formato: 'Isso não parece um celular brasileiro.',
  vazio: 'Cole o número com DDD.',
};

/**
 * Cadastra alguém que chamou o atendente primeiro.
 *
 * O HMAC é calculado AQUI, no servidor, porque a chave secreta não está no
 * Postgres nem pode chegar ao navegador — o mesmo caminho da importação.
 *
 * ⚠️ E é por isso que a chamada vai com a `service_role`, e não com a sessão do
 * atendente. Enquanto a RPC era executável por `authenticated`, qualquer pessoa
 * com o DevTools aberto podia chamá-la passando um HMAC inventado: a checagem
 * da lista de bloqueio não achava nada e o número de quem tinha pedido saída
 * voltava para a fila. Um identificador de telefone que o servidor calcula não
 * pode entrar por uma porta que o navegador alcança. Ver a migration
 * 20260823330200.
 *
 * `p_atendente_id` é explícito porque, sob service_role, `auth.uid()` é nulo
 * dentro da função — e quem resolve quem é o atendente é esta função aqui, pela
 * sessão, não pelo que o formulário mandar.
 *
 * Todo o resto (bloqueio, dedup, quem fica com quem) continua decidido dentro
 * da RPC.
 */
export async function adicionarContato(dados: {
  nome: string;
  telefone: string;
  chipId: string;
  municipioId?: number | null;
  candidatoId?: string | null;
}): Promise<RespostaAdicionarContato> {
  const telefone = normalizarTelefone(dados.telefone);
  if (!telefone.valido) {
    return {
      ok: false,
      motivo: 'telefone_invalido',
      detalhe: EXPLICACAO_TELEFONE[telefone.motivo],
    };
  }

  const sessao = await criarClienteServidor();
  const { data: { user } } = await sessao.auth.getUser();
  if (!user) return { ok: false, motivo: 'usuario_inativo' };

  const { hash, versao } = hashTelefone(telefone.chaveDedup);
  const nome = dados.nome.trim() || null;

  const supabase = criarClienteAdmin();
  const { data, error } = await supabase.rpc('adicionar_contato', {
    p_atendente_id: user.id,
    p_nome: nome,
    // A mesma função que monta o nome de todo mundo que veio de planilha.
    // Dentro do Postgres isto era `split_part(nome, ' ', 1)`, que mandava
    // "Bom dia, JOSE!" para quem se chamava JOSE DA SILVA.
    p_primeiro_nome: primeiroNomeDe(nome),
    p_telefone_e164: telefone.e164,
    p_chave_dedup: telefone.chaveDedup,
    p_telefone_hmac: hash,
    p_hmac_versao: versao,
    p_chip_id: dados.chipId,
    p_municipio_id: dados.municipioId ?? null,
    p_candidato_id: dados.candidatoId ?? null,
  });
  if (error) throw new Error(error.message);
  return data as RespostaAdicionarContato;
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

/**
 * Esse número já existe na base? De quem é?
 *
 * Serve ao aviso que aparece ANTES de o atendente terminar de cadastrar alguém
 * — `adicionar_contato` já recusava número de colega, mas só depois do
 * trabalho feito. Duas pessoas falando com o mesmo eleitor é o que vira
 * denúncia, então o aviso precisa vir cedo.
 *
 * O HMAC é calculado AQUI, no servidor: a chave secreta não está no Postgres
 * nem pode chegar ao navegador. É o mesmo caminho de `adicionarContato`.
 */
export async function consultarTelefone(telefone: string): Promise<ConsultaTelefone> {
  const normalizado = normalizarTelefone(telefone);
  if (!normalizado.valido) {
    return { ok: false, motivo: 'telefone_invalido', detalhe: EXPLICACAO_TELEFONE[normalizado.motivo] };
  }

  const supabase = await criarClienteServidor();
  const { hash } = hashTelefone(normalizado.chaveDedup);

  const { data, error } = await supabase.rpc('consultar_telefone', { p_telefone_hmac: hash });
  if (error) throw new Error(error.message);
  return data as ConsultaTelefone;
}

export type ConsultaTelefone =
  | {
      ok: true;
      existe: boolean;
      bloqueado: boolean;
      status?: StatusContato;
      /** O contato já é deste atendente. */
      meu?: boolean;
      /** Primeiro nome de QUEM ATENDE. Nunca o nome do contato. */
      atendente?: string | null;
      ja_falado?: boolean;
      primeiro_contato_em?: string | null;
    }
  | { ok: false; motivo: string; detalhe?: string };

/**
 * Corrige o nome e/ou o telefone de um contato, deixando rastro.
 *
 * ⚠️ Trocar o telefone é trocar a IDENTIDADE da pessoa no sistema:
 * `chave_dedup` é única e o HMAC é o que liga a lista de bloqueio. Por isso os
 * três identificadores são calculados aqui, no servidor, e a chamada vai com a
 * chave de serviço — um HMAC que o navegador pudesse inventar reabriria o
 * caminho que a migration 330200 fechou.
 *
 * `p_autor_id` é explícito porque, sob service_role, `auth.uid()` é nulo dentro
 * da função. Quem resolve quem é o autor é esta função, pela sessão.
 */
export async function corrigirContato(dados: {
  contatoId: string;
  nome?: string | null;
  telefone?: string | null;
}): Promise<RespostaCorrigir> {
  const sessao = await criarClienteServidor();
  const { data: { user } } = await sessao.auth.getUser();
  if (!user) return { ok: false, motivo: 'usuario_inativo' };

  let e164: string | null = null;
  let chave: string | null = null;
  let hash: string | null = null;
  let versao: number | null = null;

  if (dados.telefone != null && dados.telefone.trim() !== '') {
    const t = normalizarTelefone(dados.telefone);
    if (!t.valido) {
      return { ok: false, motivo: 'telefone_invalido', detalhe: EXPLICACAO_TELEFONE[t.motivo] };
    }
    e164 = t.e164;
    chave = t.chaveDedup;
    const h = hashTelefone(t.chaveDedup);
    hash = h.hash;
    versao = h.versao;
  }

  const nome = dados.nome?.trim() || null;

  const supabase = criarClienteAdmin();
  const { data, error } = await supabase.rpc('corrigir_contato', {
    p_autor_id: user.id,
    p_contato_id: dados.contatoId,
    p_nome: nome,
    // A mesma função que monta o primeiro nome de todo mundo que veio de
    // planilha — senão a saudação viraria "Bom dia, MARIA DAS D SILVA!".
    p_primeiro_nome: primeiroNomeDe(nome),
    p_telefone_e164: e164,
    p_chave_dedup: chave,
    p_telefone_hmac: hash,
    p_hmac_versao: versao,
  });
  if (error) throw new Error(error.message);
  return data as RespostaCorrigir;
}

export type RespostaCorrigir =
  | { ok: true; mudou: boolean }
  | { ok: false; motivo: string; atendente?: string | null; detalhe?: string };

/** O que já foi corrigido neste contato, para o histórico. */
export async function carregarCorrecoes(contatoId: string) {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('correcoes_do_contato', { p_contato_id: contatoId });
  if (error) throw new Error(error.message);
  return (data ?? []) as {
    campo: 'nome' | 'telefone';
    de: string | null;
    para: string | null;
    autor: string | null;
    criado_em: string;
  }[];
}

/** Uma linha da tela de escolher contato. NÃO traz telefone — ver a RPC. */
export type ContatoNaFila = {
  id: string;
  nome: string | null;
  origem: OrigemContato;
  municipio: string | null;
  lista_id: string | null;
  lista: string | null;
  criado_em: string;
  /** Marcado como "Falar depois" por este atendente, e a hora já chegou. */
  reagendado: boolean;
};

/**
 * A fila deste atendente, para ele escolher de quem falar.
 *
 * Mesmo critério de `pegarProximo` — a lista não pode oferecer alguém que a
 * fila depois recusa a entregar.
 */
export async function carregarFilaDoAtendente(
  listaId?: string | null,
  busca?: string | null,
): Promise<ContatoNaFila[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('fila_do_atendente', {
    p_lista_id: listaId ?? null,
    p_busca: busca?.trim() || null,
    p_limite: 40,
  });
  if (error) throw new Error(error.message);

  const r = data as { ok?: boolean; erro?: string; linhas?: ContatoNaFila[] };
  return r.linhas ?? [];
}

/**
 * Pega um contato ESCOLHIDO, em vez do próximo da fila.
 *
 * As travas são as mesmas do "próximo": quem confere é o banco, e passar um id
 * daqui não autoriza nada.
 */
export type RespostaEscolhido =
  | Extract<RespostaFila, { ok: true }>
  | {
      ok: false;
      /**
       * Os motivos da fila, mais um só desta função.
       *
       * `contato_indisponivel` cobre de propósito quatro casos diferentes —
       * o contato não existe, não é da sua lista, já foi pego por outro, ou
       * está bloqueado. Separar os quatro transformaria esta chamada num
       * oráculo sobre o que existe na base fora do alcance de quem pergunta.
       */
      motivo: MotivoFila | 'contato_indisponivel';
      fila: FilaStatus;
    };

export async function pegarEscolhido(
  contatoId: string,
  chipId: string,
): Promise<RespostaEscolhido> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('pegar_contato_especifico', {
    p_contato_id: contatoId,
    p_chip_id: chipId,
  });
  if (error) throw new Error(error.message);
  return data as RespostaEscolhido;
}
