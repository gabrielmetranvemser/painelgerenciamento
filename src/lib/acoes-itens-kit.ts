'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { ITENS_PADRAO, type ItemKit } from '@/lib/itens-kit';

/**
 * Os itens ativos, para qualquer tela que ofereça o pedido de material.
 *
 * Vai pela função do banco, e não pela tabela, porque a página pública do
 * candidato é servida com `service_role` para um eleitor anônimo — a policy de
 * leitura não o alcança.
 *
 * Se a consulta falhar, devolve `ITENS_PADRAO` em vez de lista vazia: um
 * formulário sem nenhum item é indistinguível de "a campanha não entrega mais
 * material", e é a página pública que pagaria por isso.
 */
export async function carregarItensKit(): Promise<ItemKit[]> {
  const supabase = criarClienteAdmin();
  const { data, error } = await supabase.rpc('itens_kit_ativos');
  if (error || !data || data.length === 0) return [...ITENS_PADRAO];
  return data as ItemKit[];
}

/** Todos, inclusive os desativados. Só o gestor. */
export async function carregarItensKitTodos() {
  await exigirGestorOuFalhar();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from('itens_kit').select('*').order('ordem').order('rotulo');
  if (error) throw new Error(error.message);
  return (data ?? []) as (ItemKit & { ordem: number; ativo: boolean })[];
}

export type ResultadoItem = { ok: true } | { ok: false; erro: string };

export async function salvarItemKit(dados: {
  chave: string;
  rotulo: string;
  pedeTamanho: boolean;
  ordem: number;
}): Promise<ResultadoItem> {
  await exigirGestorOuFalhar();

  const chave = dados.chave.trim().toLowerCase();
  if (!/^[a-z][a-z0-9_]{1,29}$/.test(chave)) {
    return {
      ok: false,
      erro: 'A chave só aceita letras minúsculas, números e _, começando por letra (ex.: bone).',
    };
  }
  const rotulo = dados.rotulo.trim();
  if (rotulo.length < 2 || rotulo.length > 40) {
    return { ok: false, erro: 'O nome precisa ter de 2 a 40 caracteres.' };
  }

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('itens_kit').upsert({
    chave,
    rotulo,
    pede_tamanho: dados.pedeTamanho,
    ordem: dados.ordem,
  });
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/**
 * Liga e desliga um item.
 *
 * ⚠️ Não existe apagar, e é de propósito: a chave fica gravada em
 * `captacoes.itens` de quem já pediu. Apagar a linha deixaria o relatório de
 * entregas mostrando uma chave crua que ninguém sabe traduzir.
 */
export async function alternarItemKit(chave: string, ativo: boolean): Promise<ResultadoItem> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('itens_kit').update({ ativo }).eq('chave', chave);
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}
