'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { exigirGestorOuFalhar } from '@/lib/gestor';

export type Resultado = { ok: true } | { ok: false; erro: string };

const Config = z.object({
  candidato: z.string().trim().max(120),
  cargo: z.string().trim().max(80),
  numero: z.string().trim().max(10),
  teto_diario: z.coerce.number().int().min(1).max(200),
  hora_inicio: z.coerce.number().int().min(0).max(23),
  hora_fim: z.coerce.number().int().min(1).max(24),
  intervalo_seg: z.coerce.number().int().min(0).max(3600),
  lease_minutos: z.coerce.number().int().min(1).max(240),
  timezone: z.string().trim().min(3),
  termo_texto: z.string(),
  material_titulo: z.string().trim().max(120),
  material_texto: z.string(),
  responsavel_dados: z.string().trim().max(200),
  kit_ativo: z.boolean(),
});

export async function salvarConfig(_anterior: Resultado | null, form: FormData): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const analise = Config.safeParse({
    candidato: form.get('candidato'),
    cargo: form.get('cargo'),
    numero: form.get('numero'),
    teto_diario: form.get('teto_diario'),
    hora_inicio: form.get('hora_inicio'),
    hora_fim: form.get('hora_fim'),
    intervalo_seg: form.get('intervalo_seg'),
    lease_minutos: form.get('lease_minutos'),
    timezone: form.get('timezone'),
    termo_texto: form.get('termo_texto') ?? '',
    material_titulo: form.get('material_titulo') ?? '',
    material_texto: form.get('material_texto') ?? '',
    responsavel_dados: form.get('responsavel_dados') ?? '',
    kit_ativo: form.get('kit_ativo') === 'on',
  });

  if (!analise.success) return { ok: false, erro: analise.error.issues[0].message };
  if (analise.data.hora_fim <= analise.data.hora_inicio) {
    return { ok: false, erro: 'A hora de fim precisa ser maior que a de início.' };
  }

  const supabase = criarClienteAdmin();
  const { error } = await supabase
    .from('config')
    .update({ ...analise.data, atualizado_em: new Date().toISOString() })
    .eq('id', 1);

  if (error) return { ok: false, erro: error.message };

  revalidatePath('/gestor/configuracao');
  revalidatePath('/kit');
  return { ok: true };
}

/** Dia em que não se fala com ninguém. É tabela porque existe 1º e 2º turno. */
export async function adicionarDiaBloqueado(data: string, motivo: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase
    .from('dias_bloqueados')
    .insert({ data, motivo: motivo.trim() || 'Dia da eleição' });
  if (error) return { ok: false, erro: error.message.includes('duplicate') ? 'Essa data já está bloqueada.' : error.message };
  revalidatePath('/gestor/configuracao');
  return { ok: true };
}

export async function removerDiaBloqueado(data: string) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  await supabase.from('dias_bloqueados').delete().eq('data', data);
  revalidatePath('/gestor/configuracao');
}

/** Troca o destino sem invalidar os tokens já enviados. */
export async function salvarDestino(chave: string, url: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const limpa = url.trim();
  if (limpa && !limpa.startsWith('/') && !/^https?:\/\//i.test(limpa)) {
    return { ok: false, erro: 'A URL precisa começar com https:// ou com / para páginas nossas.' };
  }
  const supabase = criarClienteAdmin();
  const { error } = await supabase
    .from('destinos')
    .update({ url: limpa, atualizado_em: new Date().toISOString() })
    .eq('chave', chave);
  if (error) return { ok: false, erro: error.message };
  revalidatePath('/gestor/configuracao');
  return { ok: true };
}
