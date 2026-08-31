'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { hashTelefone } from '@/lib/hmac';
import { casarMunicipio, type LinhaPreparada } from '@/lib/importacao';
import type { OrigemContato } from '@/lib/tipos-banco';

/** Toda ação desta tela é de gestor. Confirma no servidor, não na navegação. */
async function exigirGestorOuFalhar(): Promise<string> {
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Entre de novo.');

  const { data } = await supabase.from('usuarios').select('papel, ativo').eq('id', user.id).single();
  if (!data?.ativo || data.papel !== 'gestor') throw new Error('Só o gestor importa listas.');
  return user.id;
}

export type DadosLista = {
  origem: OrigemContato;
  rotulo: string;
  entreguePor?: string | null;
  entregueEm?: string | null;
  arquivoNome?: string | null;
  totalLinhas: number;
  /**
   * Já se sabe antes de gravar a primeira linha — sai da análise do arquivo.
   * Gravar agora, e não no fim, é o que faz a lista contar a verdade mesmo se a
   * aba fechar no meio.
   */
  totalInvalidos: number;
};

/**
 * Cria a lista. A trava de procedência da lista fria é um CHECK no banco:
 * se `entregue_por` vier vazio, o insert falha e a importação não começa.
 * Sem rastreabilidade não há defesa (docs/01-VISAO-GERAL.md §9.1).
 */
export async function criarLista(dados: DadosLista): Promise<{ ok: true; id: string } | { ok: false; erro: string }> {
  const gestorId = await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const { data, error } = await supabase
    .from('listas')
    .insert({
      origem: dados.origem,
      rotulo: dados.rotulo.trim(),
      entregue_por: dados.entreguePor?.trim() || null,
      entregue_em: dados.entregueEm || null,
      arquivo_nome: dados.arquivoNome ?? null,
      total_linhas: dados.totalLinhas,
      total_invalidos: dados.totalInvalidos,
      criado_por: gestorId,
    })
    .select('id')
    .single();

  if (error) {
    if (error.message.includes('lista_fria_exige_procedencia')) {
      return {
        ok: false,
        erro: 'Lista fria não entra sem quem entregou e quando. Isso é exigência jurídica, não campo opcional.',
      };
    }
    return { ok: false, erro: error.message };
  }
  return { ok: true, id: data.id };
}

export type ConferenciaBloco = { jaExistem: number; bloqueados: number };

/**
 * Confere um bloco contra o banco SEM gravar nada — é o que alimenta a tela de
 * conferência.
 *
 * `jaExistem` deixou de significar "vão ser descartadas". Desde
 * `reimportar_atualiza_sem_perder_historico`, essas pessoas VÊM para a lista
 * nova, com nome e município atualizados e o histórico intacto. A tela conta
 * isso em verde, ao lado das novas, porque é trabalho que vai acontecer — e não
 * perda.
 */
export async function conferirBloco(chaves: string[]): Promise<ConferenciaBloco> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  // O HMAC é calculado aqui, no servidor: a chave secreta nunca vai ao navegador.
  const hashes = chaves.map((c) => hashTelefone(c).hash);

  /**
   * ⚠️ RPC, e não `.in('telefone_hmac', hashes)`.
   *
   * Um `.in()` do PostgREST vai na URL, e cada HMAC tem 64 caracteres. Com o
   * bloco de 500 que esta tela usa, a URL passava de 32 mil caracteres e o
   * servidor devolvia "Bad Request" — medido: quebra a partir de ~240 hashes.
   *
   * Pior que quebrar: quebrava EM SILÊNCIO. O código lia só `{ data }`, `data`
   * vinha nulo, o contador somava zero, e a tela anunciava "0 já na base" com
   * toda a confiança do mundo — para qualquer planilha com mais de 230 linhas,
   * que são todas as de verdade. Alimentou a confusão de "importei e ficou
   * zerada": o gestor via um número na conferência e outro no resultado.
   *
   * A RPC recebe os hashes no CORPO, onde não há limite prático. E o `error`
   * agora é lido, e vira exceção: número errado em silêncio é pior que erro.
   */
  const { data, error } = await supabase.rpc('conferir_importacao', { p_hashes: hashes });
  if (error) throw new Error(`Não consegui conferir contra a base: ${error.message}`);

  const r = data as { ja_existem: number; bloqueados: number };
  return { jaExistem: Number(r.ja_existem ?? 0), bloqueados: Number(r.bloqueados ?? 0) };
}

export type ResultadoBloco = {
  /** Pessoas que não existiam na base. */
  novos: number;
  /** Já existiam: mudaram de lista e tiveram nome e município atualizados. */
  atualizados: number;
  bloqueados: number;
  /** Dos atualizados, os que ainda não tinham sido abordados e voltaram à fila. */
  devolvidos: number;
};

/**
 * Grava um bloco. Reentrante: repetir o mesmo bloco não duplica nada.
 *
 * ⚠️ A GRAVAÇÃO INTEIRA MORA NO BANCO, em `importar_contatos`. Não é preferência
 * de arquitetura: o que fazer com um número que já existe depende de coisas que
 * só o banco sabe no mesmo instante — se a pessoa já foi abordada, se está na
 * mão de alguém agora, se pediu saída. Decidir isso aqui exigiria ler, pensar e
 * escrever em três idas separadas, e entre a leitura e a escrita um atendente
 * pode ter pegado o contato.
 *
 * Antes daqui só fica o que o navegador não pode fazer: o HMAC (a chave secreta
 * não vai ao cliente) e o casamento do município com a lista fechada.
 */
export async function importarBloco(
  listaId: string,
  origem: OrigemContato,
  linhas: LinhaPreparada[],
): Promise<ResultadoBloco> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const { data: municipios } = await supabase.from('municipios').select('id, nome');

  const preparadas = linhas.map((l) => {
    const { hash, versao } = hashTelefone(l.chaveDedup);
    return {
      nome: l.nome,
      primeiro_nome: l.primeiroNome,
      e164: l.e164,
      chave_dedup: l.chaveDedup,
      hmac: hash,
      hmac_versao: versao,
      municipio_id: casarMunicipio(l.municipioNome, municipios ?? []),
    };
  });

  if (preparadas.length === 0) {
    return { novos: 0, atualizados: 0, bloqueados: 0, devolvidos: 0 };
  }

  const { data, error } = await supabase.rpc('importar_contatos', {
    p_lista_id: listaId,
    p_origem: origem,
    p_linhas: preparadas,
  });

  if (error) throw new Error(error.message);
  return data as ResultadoBloco;
}

/**
 * Quantos nomes de cidade da planilha NÃO casaram com a lista fechada de
 * municípios.
 *
 * Existe como rede de segurança de encoding. Um CSV salvo pelo Excel em
 * português vem em Windows-1252, e lido como UTF-8 "Ji-Paraná" vira
 * "Ji-Paran?" — que não casa com município nenhum. O relatório por cidade, que
 * é o que orienta onde a campanha põe o pé, cai inteiro em "(não informado)" e
 * ninguém percebe, porque a importação termina dizendo que deu tudo certo.
 *
 * O leitor de arquivo já tenta corrigir o encoding sozinho. Isto é o que avisa
 * quando ele não conseguiu.
 */
export async function conferirMunicipios(
  nomes: string[],
): Promise<{ semCasar: number; exemplos: string[] }> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { data: municipios } = await supabase.from('municipios').select('id, nome');

  const exemplos: string[] = [];
  let semCasar = 0;

  for (const nome of nomes) {
    if (casarMunicipio(nome, municipios ?? []) !== null) continue;
    semCasar++;
    if (exemplos.length < 5 && !exemplos.includes(nome)) exemplos.push(nome);
  }

  return { semCasar, exemplos };
}

/** Fecha a lista com os totais, para o relatório e para a auditoria. */
/**
 * Fecha a lista.
 *
 * Não grava mais totais: eles já foram somados bloco a bloco. O que esta função
 * faz é carimbar que a importação chegou ao fim — é `concluida_em` nulo que
 * denuncia, na próxima abertura da tela, uma importação que morreu no meio.
 */
export async function finalizarLista(listaId: string) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  await supabase
    .from('listas')
    .update({ concluida_em: new Date().toISOString() })
    .eq('id', listaId);
}

/** Importações que começaram e não terminaram. A tela avisa o gestor. */
export async function listasInacabadas(): Promise<
  { id: string; rotulo: string; total_importados: number; criado_em: string }[]
> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { data } = await supabase
    .from('listas')
    .select('id, rotulo, total_importados, criado_em')
    .is('concluida_em', null)
    .order('criado_em', { ascending: false })
    .limit(5);
  return data ?? [];
}
