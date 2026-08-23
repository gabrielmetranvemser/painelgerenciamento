import 'server-only';
import { createServerClient } from '@supabase/ssr';
import { cookies } from 'next/headers';
import { ajustarCookie } from './cookies';

/**
 * Cliente Supabase para Server Components, Server Actions e Route Handlers.
 * A sessão vive em cookie httpOnly — o token nunca fica acessível a JavaScript
 * de página, que é o que torna o roubo de sessão bem mais difícil do que com
 * token em localStorage.
 */
export async function criarClienteServidor() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (paraGravar) => {
          try {
            paraGravar.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, ajustarCookie(options)),
            );
          } catch {
            // Server Component não pode gravar cookie. O middleware já
            // renovou a sessão nesta mesma requisição.
          }
        },
      },
    },
  );
}
