'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { exigirGestorOuFalhar, gerarSenha } from '@/lib/gestor';

const Novo = z.object({
  email: z.email('E-mail inválido.'),
  primeiroNome: z.string().trim().min(2, 'Escreva o primeiro nome.').max(40),
  papel: z.enum(['atendente', 'gestor']),
});

export type ResultadoNovo =
  | { ok: true; email: string; senha: string }
  | { ok: false; erro: string };

/**
 * Cria a conta de um atendente. Ninguém se cadastra sozinho.
 * A senha é mostrada UMA vez: não guardamos senha em lugar nenhum.
 */
export async function criarAtendente(_anterior: ResultadoNovo | null, form: FormData): Promise<ResultadoNovo> {
  await exigirGestorOuFalhar();

  const analise = Novo.safeParse({
    email: String(form.get('email') ?? '').trim().toLowerCase(),
    primeiroNome: form.get('primeiro_nome'),
    papel: form.get('papel') ?? 'atendente',
  });
  if (!analise.success) return { ok: false, erro: analise.error.issues[0].message };

  const { email, primeiroNome, papel } = analise.data;
  const senha = gerarSenha();
  const supabase = criarClienteAdmin();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true, // não há fluxo de e-mail: o gestor entrega a senha
  });

  if (error) {
    return {
      ok: false,
      erro: error.message.includes('already')
        ? 'Já existe uma conta com esse e-mail.'
        : error.message,
    };
  }

  const { error: erroPerfil } = await supabase
    .from('usuarios')
    .insert({ id: data.user.id, papel, primeiro_nome: primeiroNome });

  if (erroPerfil) {
    // Sem linha em `usuarios`, a pessoa loga e não consegue fazer nada — pior
    // de diagnosticar do que a conta não existir.
    await supabase.auth.admin.deleteUser(data.user.id);
    return { ok: false, erro: erroPerfil.message };
  }

  revalidatePath('/gestor/atendentes');
  return { ok: true, email, senha };
}

export async function alternarAtivo(id: string, ativo: boolean) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  await supabase.from('usuarios').update({ ativo }).eq('id', id);
  revalidatePath('/gestor/atendentes');
}

/** Nova senha para quem esqueceu. Mostrada uma vez. */
export async function redefinirSenha(id: string): Promise<{ ok: boolean; senha?: string }> {
  await exigirGestorOuFalhar();
  const senha = gerarSenha();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.auth.admin.updateUserById(id, { password: senha });
  return error ? { ok: false } : { ok: true, senha };
}
