'use server';

import { revalidarInterno } from '@/lib/revalidar';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { podeSalvar, validarModelo } from '@/lib/mensagem';
import type { ModeloLivre } from '@/lib/tipos-banco';

/** As mensagens do gestor. Ativas primeiro, na ordem que ele definiu. */
export async function carregarModelosLivres(somenteAtivos = false): Promise<ModeloLivre[]> {
  const supabase = await criarClienteServidor();
  let q = supabase.from('modelos_livres').select('*').order('ordem').order('nome');
  if (somenteAtivos) q = q.eq('ativo', true);
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as ModeloLivre[];
}

export type ResultadoLivre = { ok: true } | { ok: false; erro: string };

/**
 * Cria ou atualiza uma mensagem do gestor.
 *
 * ⚠️ PASSA PELA MESMA `validarModelo` das sete etapas fixas, com a etapa
 * `livre`. Lá, `livre` não tem regra de conteúdo própria — as regras das outras
 * etapas são sobre o PAPEL de cada uma na conversa (a permissão declara a
 * chapa, o material se identifica), e uma mensagem livre não tem papel fixo.
 *
 * O que continua valendo, e é o que importa: variável que não existe IMPEDE
 * salvar. Sem isso, `{{nome_do_candidato}}` sairia cru no WhatsApp de um
 * eleitor — e esse é o tipo de erro que só aparece depois de enviado.
 */
export async function salvarModeloLivre(dados: {
  id?: string;
  nome: string;
  dica: string | null;
  texto: string;
  eAbordagem: boolean;
  ordem: number;
}): Promise<ResultadoLivre> {
  await exigirGestorOuFalhar();

  const nome = dados.nome.trim();
  if (nome.length < 2 || nome.length > 60) {
    return { ok: false, erro: 'O nome precisa ter de 2 a 60 caracteres.' };
  }

  const problemas = validarModelo('livre', dados.texto);
  if (!podeSalvar(problemas)) {
    return { ok: false, erro: problemas.find((p) => p.nivel === 'impede')!.mensagem };
  }

  const linha = {
    nome,
    dica: dados.dica?.trim() || null,
    texto: dados.texto.trim(),
    e_abordagem: dados.eAbordagem,
    ordem: dados.ordem,
    atualizado_em: new Date().toISOString(),
  };

  const supabase = criarClienteAdmin();
  const { error } = dados.id
    ? await supabase.from('modelos_livres').update(linha).eq('id', dados.id)
    : await supabase.from('modelos_livres').insert(linha);

  if (error) return { ok: false, erro: error.message };
  revalidarInterno('/gestor/mensagens');
  return { ok: true };
}

/**
 * Liga e desliga uma mensagem.
 *
 * ⚠️ Não existe apagar. `interacoes.modelo_livre_id` aponta para esta linha, e
 * é prova de auditoria: apagar deixaria no histórico do contato uma mensagem
 * enviada que ninguém consegue mais ler. Desativada, ela some da tela do
 * atendente e continua legível no histórico.
 */
export async function alternarModeloLivre(id: string, ativo: boolean): Promise<ResultadoLivre> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('modelos_livres').update({ ativo }).eq('id', id);
  if (error) return { ok: false, erro: error.message };
  revalidarInterno('/gestor/mensagens');
  return { ok: true };
}
