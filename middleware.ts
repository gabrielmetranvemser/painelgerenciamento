import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { ajustarCookie } from '@/lib/supabase/cookies';

/**
 * Renova a sessão a cada requisição e barra as áreas internas de quem não está
 * logado. A checagem de PAPEL (gestor x atendente) fica nos layouts, que já
 * consultam o banco — repetir aqui custaria uma ida ao banco por requisição.
 */
export async function middleware(request: NextRequest) {
  let resposta = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (paraGravar) => {
          paraGravar.forEach(({ name, value }) => request.cookies.set(name, value));
          resposta = NextResponse.next({ request });
          paraGravar.forEach(({ name, value, options }) =>
            resposta.cookies.set(name, value, ajustarCookie(options)),
          );
        },
      },
    },
  );

  // Não remover: é esta chamada que renova o token antes de expirar.
  const { data: { user } } = await supabase.auth.getUser();

  const caminho = request.nextUrl.pathname;
  const interna = caminho.startsWith('/painel') || caminho.startsWith('/gestor') || caminho === '/termo';

  if (interna && !user) {
    const url = request.nextUrl.clone();
    url.pathname = '/entrar';
    url.searchParams.set('proximo', caminho);
    return NextResponse.redirect(url);
  }

  if (caminho === '/entrar' && user) {
    const url = request.nextUrl.clone();
    url.pathname = '/painel';
    url.search = '';
    return NextResponse.redirect(url);
  }

  return resposta;
}

export const config = {
  matcher: [
    // Tudo, menos estáticos e as rotas públicas de captação (/r, /m, /kit),
    // que precisam responder rápido e sem sessão.
    '/((?!_next/static|_next/image|favicon.ico|r/|m/|kit|site|privacidade|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
