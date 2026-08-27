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

export type ResultadoRenomear = { ok: true } | { ok: false; erro: string };

/**
 * Troca o primeiro nome de quem já está cadastrado.
 *
 * ⚠️ Não é só rótulo de tela: é o nome que a PESSOA DO OUTRO LADO lê. A
 * primeira mensagem diz "Aqui é o Lucas", e a partir do próximo envio ela passa
 * a dizer o nome novo — quem já foi abordado continua com o antigo no histórico
 * da conversa dele, e é por isso que a tela avisa antes.
 *
 * O limite de 2 a 40 caracteres é `check` da tabela; aqui a validação existe
 * para o erro sair em português em vez de "violates check constraint".
 */
export async function renomearAtendente(id: string, primeiroNome: string): Promise<ResultadoRenomear> {
  await exigirGestorOuFalhar();

  const nome = primeiroNome.trim();
  if (nome.length < 2) return { ok: false, erro: 'Escreva o primeiro nome (pelo menos 2 letras).' };
  if (nome.length > 40) return { ok: false, erro: 'Nome muito longo (máximo 40 caracteres).' };

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('usuarios').update({ primeiro_nome: nome }).eq('id', id);
  if (error) return { ok: false, erro: error.message };

  revalidatePath('/gestor/atendentes');
  return { ok: true };
}

/**
 * O e-mail de cada conta, que é por onde a pessoa entra.
 *
 * ⚠️ Ele mora em `auth.users`, não em `public.usuarios` — a tela do gestor não
 * tinha como mostrá-lo, e quem perdia o e-mail de um atendente ficava sem saber
 * qual conta redefinir.
 *
 * `listUsers` vem paginado e o padrão é 50 por página: com a equipe crescendo,
 * pedir uma página só faria os últimos sumirem da tela em silêncio — o mesmo
 * defeito do corte de 1.000 linhas do PostgREST. Por isso o laço, que avança
 * enquanto vier página cheia.
 */
export async function emailsDasContas(): Promise<Record<string, string>> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const POR_PAGINA = 200;
  const emails: Record<string, string> = {};

  for (let pagina = 1; pagina <= 50; pagina++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: POR_PAGINA });
    if (error) throw new Error(error.message);

    for (const u of data.users) {
      if (u.email) emails[u.id] = u.email;
    }
    if (data.users.length < POR_PAGINA) break;
  }

  return emails;
}
