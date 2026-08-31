'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';

/**
 * Sem `revalidatePath`, como no resto do /gestor: as telas são `force-dynamic`
 * e quem atualiza depois da ação é o `router.refresh()` do componente.
 *
 * Estas ações são usadas por DUAS telas — a de Listas e a de Atendentes. É o
 * mesmo dado visto de dois lados ("quem atende esta lista" e "quais listas são
 * desta pessoa"), e duplicar a gravação seria criar duas verdades.
 */

export type Resultado = { ok: true } | { ok: false; erro: string };

/** O nome é o que o gestor lê na hora de distribuir. Vazio não serve. */
export async function renomearLista(listaId: string, rotulo: string): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const nome = rotulo.trim();
  if (nome.length < 2) return { ok: false, erro: 'Dê um nome com pelo menos 2 letras.' };
  if (nome.length > 80) return { ok: false, erro: 'Nome muito longo (máximo 80 caracteres).' };

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('listas').update({ rotulo: nome }).eq('id', listaId);
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/**
 * Pausar uma lista.
 *
 * Pausada, ela sai da fila de todo mundo na hora — mesmo de quem tem a lista
 * marcada — e os contatos continuam no banco, intactos. É o botão para "esta
 * planilha era ruim" ou "esse bairro fica para depois", sem apagar nada.
 *
 * O que pausar NÃO faz: interromper conversa já aberta. Quem está com um
 * contato dessa lista na mão termina o que começou — a pessoa do outro lado já
 * recebeu a permissão e está esperando resposta.
 */
export async function alternarListaAtiva(listaId: string, ativa: boolean): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('listas').update({ ativa }).eq('id', listaId);
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/** Põe (ou tira) um atendente numa lista. A mesma lista pode ter vários. */
export async function alternarAtendenteNaLista(
  listaId: string,
  atendenteId: string,
  dentro: boolean,
): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  if (!dentro) {
    const { error } = await supabase
      .from('atendente_listas')
      .delete()
      .eq('lista_id', listaId)
      .eq('atendente_id', atendenteId);
    if (error) return { ok: false, erro: error.message };
    return { ok: true };
  }

  // `upsert` e não `insert`: dois cliques rápidos no mesmo botão não podem
  // virar erro de chave duplicada na cara do gestor.
  const { error } = await supabase
    .from('atendente_listas')
    .upsert({ lista_id: listaId, atendente_id: atendenteId }, { ignoreDuplicates: true });
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/**
 * Marca a lista para todos os atendentes ativos.
 *
 * Existe por causa do dia em que a regra entrou: até então a fila era um bolo
 * só, e sem este botão o gestor teria de marcar lista por lista, pessoa por
 * pessoa, antes de a operação voltar a andar. Também é o atalho honesto para a
 * lista que é mesmo de todo mundo.
 */
export async function atribuirListaATodos(listaId: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const { data: atendentes, error: erroLeitura } = await supabase
    .from('usuarios')
    .select('id')
    .eq('papel', 'atendente')
    .eq('ativo', true);

  if (erroLeitura) return { ok: false, erro: erroLeitura.message };
  if (!atendentes?.length) return { ok: false, erro: 'Não há atendente ativo cadastrado.' };

  const { error } = await supabase
    .from('atendente_listas')
    .upsert(
      atendentes.map((a) => ({ lista_id: listaId, atendente_id: a.id })),
      { ignoreDuplicates: true },
    );

  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/**
 * Apagar uma lista de vez.
 *
 * ⚠️ NÃO É `delete from listas`, e a diferença importa.
 *
 * `contatos.lista_id` é `on delete set null`, e `lista_id is null` tem
 * significado próprio na fila: é "cadastrou-se sozinho", e cai para TODO
 * atendente. Apagar a linha da lista despejaria os contatos dela na fila de
 * todo mundo de uma vez — o oposto do que "apagar" quer dizer. Quem apaga é a
 * RPC `apagar_lista`, que leva os contatos junto.
 *
 * E ela RECUSA a lista em que alguém já foi abordado: ali há histórico em
 * `interacoes`, e a lista é a procedência daquela gente — de quem veio e
 * quando, que é exigência jurídica para lista fria. Nesse caso o caminho é
 * Pausar, que tira da fila na hora e não perde nada.
 *
 * Duas voltas de propósito: a primeira chamada só CONTA quantos contatos vão
 * junto, para a tela poder dizer o número antes de perguntar "tem certeza?".
 */
export type ResultadoApagar =
  | { ok: true; rotulo: string; contatosApagados: number }
  | { ok: false; motivo: 'precisa_confirmar'; total: number; rotulo: string }
  | { ok: false; motivo: 'tem_historico'; total: number; abordados: number; rotulo: string }
  | { ok: false; motivo: 'contato_em_atendimento'; naMao: number; rotulo: string }
  | { ok: false; motivo: 'somente_gestor' | 'lista_nao_existe' | 'erro'; erro?: string };

export async function apagarLista(listaId: string, confirmar = false): Promise<ResultadoApagar> {
  await exigirGestorOuFalhar();

  /**
   * ⚠️ CLIENTE DO USUÁRIO, e não o `criarClienteAdmin()` do resto deste arquivo.
   *
   * `apagar_lista` confere `is_gestor()` DENTRO do banco. Com a chave de
   * serviço não existe usuário logado — `auth.uid()` volta nulo, `is_gestor()`
   * dá falso, e a função recusa com "somente_gestor" na cara do gestor. Foi
   * exatamente o que aconteceu na primeira versão.
   *
   * A escolha certa é esta, e não tirar a conferência de lá: as duas camadas
   * valem. A ação confirma o papel antes de chamar, e o banco confirma de novo
   * — é o banco que apaga, e é lá que a trava precisa estar de pé mesmo que
   * alguém chame a RPC por outro caminho.
   */
  const supabase = await criarClienteServidor();

  const { data, error } = await supabase.rpc('apagar_lista', {
    p_lista_id: listaId,
    p_confirmar: confirmar,
  });
  if (error) return { ok: false, motivo: 'erro', erro: error.message };

  const r = data as Record<string, unknown>;
  if (r.ok === true) {
    return {
      ok: true,
      rotulo: String(r.rotulo ?? ''),
      contatosApagados: Number(r.contatos_apagados ?? 0),
    };
  }

  const motivo = String(r.motivo);
  if (motivo === 'precisa_confirmar') {
    return { ok: false, motivo, total: Number(r.total ?? 0), rotulo: String(r.rotulo ?? '') };
  }
  if (motivo === 'tem_historico') {
    return {
      ok: false, motivo,
      total: Number(r.total ?? 0), abordados: Number(r.abordados ?? 0),
      rotulo: String(r.rotulo ?? ''),
    };
  }
  if (motivo === 'contato_em_atendimento') {
    return { ok: false, motivo, naMao: Number(r.na_mao ?? 0), rotulo: String(r.rotulo ?? '') };
  }
  return { ok: false, motivo: motivo === 'lista_nao_existe' ? 'lista_nao_existe' : 'somente_gestor' };
}


/* ── Grupos de lista ─────────────────────────────────────────────────────── */

/**
 * ⚠️ Estas quatro passam pelo CLIENTE DO USUÁRIO, e não pelo admin como o resto
 * deste arquivo: as RPC conferem `is_gestor()` dentro do banco, e com a chave
 * de serviço não existe usuário logado — `auth.uid()` volta nulo e a função
 * recusa quem tem todo o direito. Foi o que aconteceu com `apagar_lista` na
 * primeira versão.
 */

export async function criarGrupo(nome: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const limpo = nome.trim();
  if (limpo.length < 2) return { ok: false, erro: 'Dê um nome com pelo menos 2 letras.' };
  if (limpo.length > 60) return { ok: false, erro: 'Nome muito longo (máximo 60 caracteres).' };

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('grupos_lista').insert({ nome: limpo });
  if (error) {
    return {
      ok: false,
      erro: error.message.includes('duplicate') || error.message.includes('grupos_lista_nome_uk')
        ? 'Já existe um grupo com esse nome.'
        : error.message,
    };
  }
  return { ok: true };
}

export async function renomearGrupo(grupoId: string, nome: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const limpo = nome.trim();
  if (limpo.length < 2) return { ok: false, erro: 'Dê um nome com pelo menos 2 letras.' };

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('grupos_lista').update({ nome: limpo }).eq('id', grupoId);
  if (error) {
    return {
      ok: false,
      erro: error.message.includes('duplicate') || error.message.includes('grupos_lista_nome_uk')
        ? 'Já existe um grupo com esse nome.'
        : error.message,
    };
  }
  return { ok: true };
}

/**
 * Liga ou desliga o grupo inteiro.
 *
 * Desligar pausa todas as listas ATIVAS dele; religar traz de volta só as que
 * ele mesmo pausou. Lista que o gestor tirou do ar à mão continua fora — ele
 * não pediu para religar aquela.
 */
export async function alternarGrupo(
  grupoId: string,
  ativo: boolean,
): Promise<{ ok: true; listasAfetadas: number } | { ok: false; erro: string }> {
  await exigirGestorOuFalhar();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('alternar_grupo', {
    p_grupo_id: grupoId, p_ativo: ativo,
  });
  if (error) return { ok: false, erro: error.message };
  const r = data as { ok: boolean; motivo?: string; listas_afetadas?: number };
  if (!r.ok) return { ok: false, erro: r.motivo === 'somente_gestor' ? 'Só o gestor mexe em grupos.' : 'Esse grupo já não existe.' };
  return { ok: true, listasAfetadas: Number(r.listas_afetadas ?? 0) };
}

export async function moverListaParaGrupo(listaId: string, grupoId: string | null): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('mover_lista_para_grupo', {
    p_lista_id: listaId, p_grupo_id: grupoId,
  });
  if (error) return { ok: false, erro: error.message };
  const r = data as { ok: boolean; motivo?: string };
  return r.ok ? { ok: true } : { ok: false, erro: `Não consegui mover (${r.motivo}).` };
}

/** Apagar o grupo não apaga lista nenhuma — só desfaz o vínculo. */
export async function apagarGrupo(
  grupoId: string,
): Promise<{ ok: true; listasReligadas: number } | { ok: false; erro: string }> {
  await exigirGestorOuFalhar();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('apagar_grupo', { p_grupo_id: grupoId });
  if (error) return { ok: false, erro: error.message };
  const r = data as { ok: boolean; motivo?: string; listas_religadas?: number };
  if (!r.ok) return { ok: false, erro: 'Só o gestor mexe em grupos.' };
  return { ok: true, listasReligadas: Number(r.listas_religadas ?? 0) };
}
