import 'server-only';
import { redirect } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { rotas } from '@/lib/links-internos';
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

/**
 * Exige sessão ativa, termo aceito e conta ativa.
 *
 * Recebe `entrada` — o segmento secreto da URL atual — porque todo endereço
 * interno vive embaixo dele. Ler a chave de variável de ambiente aqui também
 * funcionaria, mas usar o que já está na URL mantém a chave fora de qualquer
 * caminho que possa acabar no pacote do navegador.
 */
export async function exigirAtendente(entrada: string): Promise<Usuario> {
  const r = rotas(entrada);
  const u = await usuarioAtual();
  if (!u) redirect(r.entrar);
  if (!u.ativo) redirect(`${r.entrar}?erro=inativo`);
  if (!u.termo_aceito_em) redirect(r.termo);
  return u;
}

/** Exige papel de gestor. */
export async function exigirGestor(entrada: string): Promise<Usuario> {
  const r = rotas(entrada);
  const u = await usuarioAtual();
  if (!u) redirect(r.entrar);
  if (!u.ativo) redirect(`${r.entrar}?erro=inativo`);
  if (u.papel !== 'gestor') redirect(r.painel);
  return u;
}
