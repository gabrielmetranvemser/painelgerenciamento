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
 * "10.000 linhas · 8.740 aproveitáveis · 1.190 repetidas · 70 bloqueadas".
 */
export async function conferirBloco(chaves: string[]): Promise<ConferenciaBloco> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  // O HMAC é calculado aqui, no servidor: a chave secreta nunca vai ao navegador.
  const hashes = chaves.map((c) => hashTelefone(c).hash);

  const [{ data: existentes }, { data: bloqueados }] = await Promise.all([
    supabase.from('contatos').select('telefone_hmac').in('telefone_hmac', hashes),
    supabase.from('bloqueios').select('telefone_hmac').in('telefone_hmac', hashes),
  ]);

  const setBloqueados = new Set((bloqueados ?? []).map((b) => b.telefone_hmac));
  // Um número bloqueado que também já é contato conta uma vez só, como bloqueado:
  // é o motivo mais forte e o que o gestor precisa ver.
  const jaExistem = (existentes ?? []).filter((e) => !setBloqueados.has(e.telefone_hmac)).length;

  return { jaExistem, bloqueados: setBloqueados.size };
}

export type ResultadoBloco = { importados: number; duplicados: number; bloqueados: number };

/** Grava um bloco. Reentrante: repetir o mesmo bloco não duplica nada. */
export async function importarBloco(
  listaId: string,
  origem: OrigemContato,
  linhas: LinhaPreparada[],
): Promise<ResultadoBloco> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const { data: municipios } = await supabase.from('municipios').select('id, nome');

  const comHash = linhas.map((l) => ({ ...l, ...hashTelefone(l.chaveDedup) }));
  const hashes = comHash.map((l) => l.hash);

  const { data: bloqueios } = await supabase
    .from('bloqueios')
    .select('telefone_hmac')
    .in('telefone_hmac', hashes);
  const setBloqueados = new Set((bloqueios ?? []).map((b) => b.telefone_hmac));

  const paraInserir = comHash
    .filter((l) => !setBloqueados.has(l.hash))
    .map((l) => ({
      lista_id: listaId,
      origem,
      nome: l.nome,
      primeiro_nome: l.primeiroNome,
      telefone_e164: l.e164,
      chave_dedup: l.chaveDedup,
      telefone_hmac: l.hash,
      hmac_versao: l.versao,
      municipio_id: casarMunicipio(l.municipioNome, municipios ?? []),
      status: 'na_fila' as const,
    }));

  if (paraInserir.length === 0) {
    return { importados: 0, duplicados: 0, bloqueados: setBloqueados.size };
  }

  // `ignoreDuplicates` sobre o UNIQUE de telefone_hmac: quem já existe é
  // ignorado em silêncio, e o bloco inteiro não falha por causa de um repetido.
  const { data, error } = await supabase
    .from('contatos')
    .upsert(paraInserir, { onConflict: 'telefone_hmac', ignoreDuplicates: true })
    .select('id');

  if (error) throw new Error(error.message);

  const importados = data?.length ?? 0;
  const totais = {
    importados,
    duplicados: paraInserir.length - importados,
    bloqueados: setBloqueados.size,
  };

  // Soma AQUI, não no fim. Ver a migration 20260823340400: os totais da lista
  // são a rastreabilidade da base, e uma aba fechada no meio deixava metade dos
  // contatos na fila com a lista dizendo que importou zero.
  await supabase.rpc('somar_totais_lista', {
    p_lista_id: listaId,
    p_importados: totais.importados,
    p_duplicados: totais.duplicados,
    p_bloqueados: totais.bloqueados,
  });

  return totais;
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
