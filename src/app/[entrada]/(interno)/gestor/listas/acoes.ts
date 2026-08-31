'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
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
  const supabase = criarClienteAdmin();

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
