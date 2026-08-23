import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { ajustarCookie } from '@/lib/supabase/cookies';

/**
 * Renova a sessão e barra as áreas internas de quem não está logado.
 *
 * Tudo que é interno vive sob o primeiro segmento secreto (PAINEL_CHAVE). Quem
 * não sabe a chave nem chega aqui: o layout de `[entrada]/(interno)` devolve
 * 404, igual a qualquer endereço inexistente.
 *
 * A checagem de PAPEL (gestor x atendente) fica nos layouts, que já consultam o
 * banco — repetir aqui custaria uma ida ao banco por requisição.
 */
export async function middleware(request: NextRequest) {
  const chave = process.env.PAINEL_CHAVE ?? '';
  const caminho = request.nextUrl.pathname;

  if (!chave) return NextResponse.next({ request });

  const entrar = `/${chave}/entrar`;
  const interna = caminho.startsWith(`/${chave}/`);

  // O pacote da extensão leva dentro o endereço do painel, com a chave.
  //
  // A proteção que vale é o NOME do arquivo, que deriva da própria chave: achar
  // o zip é tão difícil quanto achar o painel, e quem já tem a chave não ganha
  // nada baixando o arquivo.
  //
  // Esta checagem é a segunda camada, e ela NÃO é confiável em
  // desenvolvimento: o servidor de dev entrega arquivo de `public/` antes de
  // passar por aqui. Em produção ela pega. Não conte com ela como se fosse a
  // tranca.
  const pacote = caminho === `/${chave}-ext.zip`;

  // Endereço público — a página de um candidato, por exemplo. Não há sessão
  // para renovar e `getUser()` é uma ida ao Supabase por visita. A página de
  // candidato é a mais acessada do sistema e é aberta por gente que nunca vai
  // ter conta: pagar autenticação nela seria pagar por nada.
  if (!interna && !pacote) return NextResponse.next({ request });

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

  if (!user && caminho !== entrar) {
    const url = request.nextUrl.clone();
    url.pathname = entrar;
    url.search = '';
    if (interna) url.searchParams.set('proximo', caminho);
    return NextResponse.redirect(url);
  }

  if (caminho === entrar && user) {
    const url = request.nextUrl.clone();
    url.pathname = `/${chave}/painel`;
    url.search = '';
    return NextResponse.redirect(url);
  }

  return resposta;
}

export const config = {
  matcher: [
    // Fora: estáticos e as rotas públicas de captação, que precisam responder
    // rápido e sem sessão.
    '/((?!_next/static|_next/image|favicon\\.ico|robots\\.txt|r/|m/|privacidade|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
};
