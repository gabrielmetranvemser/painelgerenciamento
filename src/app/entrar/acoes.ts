'use server';

import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';

export async function entrar(_anterior: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const senha = String(form.get('senha') ?? '');
  const proximo = String(form.get('proximo') ?? '/painel');

  if (!email || !senha) return 'Preencha e-mail e senha.';

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

  // Mensagem genérica de propósito: dizer "esse e-mail não existe" entrega a
  // lista de atendentes para quem estiver tentando adivinhar.
  if (error) return 'E-mail ou senha incorretos.';

  redirect(proximo.startsWith('/') ? proximo : '/painel');
}

export async function sair() {
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect('/entrar');
}
