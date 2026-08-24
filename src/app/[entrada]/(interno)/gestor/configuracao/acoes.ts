'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { exigirGestorOuFalhar } from '@/lib/gestor';

export type Resultado = { ok: true } | { ok: false; erro: string };

/**
 * Só o que é da OPERAÇÃO.
 *
 * Nome, cargo, número, material e página de cada candidatura moram em
 * `candidatos` / `materiais`. Já existiu cópia disso aqui, e ela saiu de
 * sincronia: a página pública anunciava um candidato enquanto o atendente
 * mandava material de outro.
 */
/**
 * O fuso tem de ser um nome que o Postgres reconheça.
 *
 * ⚠️ Não é validação cosmética. Toda conta de hora do sistema faz
 * `now() at time zone config.timezone`, e um nome que o banco não conhece não
 * devolve nulo — lança. Um "America/PortoVelho" digitado aqui derrubava a fila,
 * o envio e as três automações de uma vez, para os 15 atendentes.
 *
 * `Intl.DateTimeFormat` recusa exatamente os mesmos nomes que o Postgres — as
 * duas implementações leem a mesma base IANA. O banco confere de novo, por
 * gatilho, porque é lá que o estrago acontece.
 */
function fusoExiste(valor: string): boolean {
  try {
    new Intl.DateTimeFormat('pt-BR', { timeZone: valor });
    return true;
  } catch {
    return false;
  }
}

const Config = z.object({
  teto_diario: z.coerce.number().int().min(1).max(200),
  hora_inicio: z.coerce.number().int().min(0).max(23),
  hora_fim: z.coerce.number().int().min(1).max(24),
  intervalo_seg: z.coerce.number().int().min(0).max(3600),
  lease_minutos: z.coerce.number().int().min(1).max(240),
  timezone: z.string().trim().min(3).refine(fusoExiste, {
    message:
      'Esse fuso horário não existe. Escreva como America/Porto_Velho — com barra, ' +
      'sublinhado e as maiúsculas no lugar.',
  }),
  termo_texto: z.string(),
  responsavel_dados: z.string().trim().max(200),
});

export async function salvarConfig(_anterior: Resultado | null, form: FormData): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const analise = Config.safeParse({
    teto_diario: form.get('teto_diario'),
    hora_inicio: form.get('hora_inicio'),
    hora_fim: form.get('hora_fim'),
    intervalo_seg: form.get('intervalo_seg'),
    lease_minutos: form.get('lease_minutos'),
    timezone: form.get('timezone'),
    termo_texto: form.get('termo_texto') ?? '',
    responsavel_dados: form.get('responsavel_dados') ?? '',
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

