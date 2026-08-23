import 'server-only';
import { criarClienteServidor } from '@/lib/supabase/server';

/**
 * Confirma no servidor que quem chamou é gestor ativo.
 * Toda Server Action de /gestor começa por aqui — a navegação bloqueada no
 * layout não é garantia nenhuma: Server Action é um endpoint HTTP.
 */
export async function exigirGestorOuFalhar(): Promise<string> {
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) throw new Error('Sessão expirada. Entre de novo.');

  const { data } = await supabase.from('usuarios').select('papel, ativo').eq('id', user.id).single();
  if (!data?.ativo || data.papel !== 'gestor') throw new Error('Ação restrita ao gestor.');
  return user.id;
}

/** Senha fácil de ditar ao telefone — o gestor entrega isso para 15 pessoas. */
export function gerarSenha(): string {
  const bytes = new Uint8Array(7);
  crypto.getRandomValues(bytes);
  const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8)}`;
}
