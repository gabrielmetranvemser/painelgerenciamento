'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { normalizarTelefone } from '@/lib/telefone';
import type { StatusChip } from '@/lib/tipos-banco';

const Novo = z.object({
  atendenteId: z.uuid('Escolha o atendente.'),
  rotulo: z.string().trim().min(2, 'Dê um nome ao número, ex.: Chip A.').max(30),
  papel: z.enum(['ativo', 'reserva']),
  numero: z.string().trim().optional(),
});

export type ResultadoChip = { ok: true } | { ok: false; erro: string };

export async function criarChip(_anterior: ResultadoChip | null, form: FormData): Promise<ResultadoChip> {
  await exigirGestorOuFalhar();

  const analise = Novo.safeParse({
    atendenteId: form.get('atendente_id'),
    rotulo: form.get('rotulo'),
    papel: form.get('papel') ?? 'ativo',
    numero: form.get('numero') ?? undefined,
  });
  if (!analise.success) return { ok: false, erro: analise.error.issues[0].message };

  let e164: string | null = null;
  if (analise.data.numero) {
    const t = normalizarTelefone(analise.data.numero);
    if (!t.valido) return { ok: false, erro: 'O número do chip não parece um celular válido.' };
    e164 = t.e164;
  }

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('chips').insert({
    atendente_id: analise.data.atendenteId,
    rotulo: analise.data.rotulo,
    papel: analise.data.papel,
    numero_e164: e164,
    status: 'aquecendo',
  });

  if (error) {
    return {
      ok: false,
      erro: error.message.includes('duplicate')
        ? 'Esse atendente já tem um número com esse nome.'
        : error.message,
    };
  }

  revalidatePath('/gestor/chips');
  return { ok: true };
}

export async function mudarStatus(chipId: string, status: StatusChip) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  await supabase.from('chips').update({ status }).eq('id', chipId);
  revalidatePath('/gestor/chips');
  revalidatePath('/gestor');
}

/**
 * Marca o número como morto.
 *
 * ⚠️ Não tem volta e não é só um status: os contatos que estavam em conversa com
 * este número viram `perdido` e NÃO voltam para a fila. Quando um chip cai, as
 * conversas dele morrem junto — reabordar quem já foi abordado por um número
 * morto é insistência (docs/03-OPERACAO.md §2.5 e §2.6).
 */
export async function matarChip(chipId: string, detalhe?: string) {
  await exigirGestorOuFalhar();
  const supabase = await criarClienteServidor();
  const { data } = await supabase.rpc('marcar_chip_morto', { p_chip_id: chipId, p_detalhe: detalhe ?? null });
  revalidatePath('/gestor/chips');
  revalidatePath('/gestor');
  return data as { ok: boolean; contatos_perdidos?: number };
}
