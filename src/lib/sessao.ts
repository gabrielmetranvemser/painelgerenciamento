import 'server-only';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Usuario } from '@/lib/tipos-banco';

/**
 * Usuário logado, já com o cadastro em `public.usuarios`.
 * `null` quando não há sessão ou quando o cadastro não existe.
 */
export async function usuarioAtual(): Promise<Usuario | null> {
  const supabase = await criarClienteServidor();

  // getUser() valida o token contra o servidor de auth. getSession() apenas lê
  // o cookie, que é falsificável — não usar para decisão de acesso.
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from('usuarios')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  return (data as Usuario | null) ?? null;
}

/** Exige sessão ativa, termo aceito e conta ativa. Redireciona quando falta. */
export async function exigirAtendente(): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect('/entrar');
  if (!u.ativo) redirect('/entrar?erro=inativo');
  if (!u.termo_aceito_em) redirect('/termo');
  return u;
}

/** Exige papel de gestor. */
export async function exigirGestor(): Promise<Usuario> {
  const u = await usuarioAtual();
  if (!u) redirect('/entrar');
  if (!u.ativo) redirect('/entrar?erro=inativo');
  if (u.papel !== 'gestor') redirect('/painel');
  return u;
}
