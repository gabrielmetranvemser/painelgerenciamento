'use server';

import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';

export async function entrar(_anterior: string | null, form: FormData): Promise<string | null> {
  const email = String(form.get('email') ?? '').trim().toLowerCase();
  const senha = String(form.get('senha') ?? '');
  const entrada = String(form.get('entrada') ?? '');
  const proximo = String(form.get('proximo') ?? '') || `/${entrada}/painel`;

  if (!email || !senha) return 'Preencha e-mail e senha.';

  const supabase = await criarClienteServidor();
  const { error } = await supabase.auth.signInWithPassword({ email, password: senha });

  // Mensagem genérica de propósito: dizer "esse e-mail não existe" entrega a
  // lista de atendentes para quem estiver tentando adivinhar.
  if (error) return 'E-mail ou senha incorretos.';

  // Só aceita destino interno, e só embaixo da própria entrada: um `proximo`
  // vindo da URL não pode virar redirecionamento para fora.
  const seguro = proximo.startsWith(`/${entrada}/`) ? proximo : `/${entrada}/painel`;
  redirect(seguro);
}

export async function sair(form: FormData) {
  const entrada = String(form.get('entrada') ?? '');
  const supabase = await criarClienteServidor();
  await supabase.auth.signOut();
  redirect(entrada ? `/${entrada}/entrar` : '/');
}
