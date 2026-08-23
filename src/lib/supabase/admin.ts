import 'server-only';
import { createClient } from '@supabase/supabase-js';

/**
 * Cliente com a service_role.
 *
 * ⚠️ IGNORA RLS. Dá acesso irrestrito a todos os contatos. Usar somente onde a
 * operação precisa mesmo passar por cima das permissões:
 *   - importação de lista (grava em nome do gestor, em lote)
 *   - criação de usuário (auth.admin)
 *   - landing pública (grava clique, captação e descadastro sem login)
 *
 * NUNCA importar de componente de cliente. O `import 'server-only'` quebra o
 * build se isso acontecer.
 */
export function criarClienteAdmin() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !chave) {
    throw new Error(
      'NEXT_PUBLIC_SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY ausentes no ambiente.',
    );
  }
  return createClient(url, chave, {
    auth: { autoRefreshToken: false, persistSession: false },
  });
}
