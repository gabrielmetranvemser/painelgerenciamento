import { createServerClient } from '@supabase/ssr';
import { NextResponse, type NextRequest } from 'next/server';
import { ajustarCookie } from '@/lib/supabase/cookies';
import { hostEhDoPainel } from '@/lib/host-do-painel';

/**
 * Renova a sessão e barra as áreas internas de quem não está logado.
 *
 * ⚠️ MORA EM `src/`, E O NOME É `proxy.ts`. Os dois importam.
 *
 * Este arquivo precisa ficar no mesmo nível de `app` — e aqui `app` está em
 * `src/`. Enquanto ele era `middleware.ts` na RAIZ do projeto, o build de
 * produção ainda o encontrava (compatibilidade), mas o `next dev` o ignorava em
 * silêncio: nada de erro, nada de aviso, o arquivo simplesmente não rodava.
 *
 * O estrago disso é maior do que parece. Em desenvolvimento a sessão nunca era
 * renovada por aqui, e qualquer trava escrita neste arquivo parecia não
 * funcionar quando na verdade nem estava sendo carregada — do tipo que faz
 * alguém "consertar" o código certo por meia hora. Se um dia este arquivo
 * voltar para a raiz, o sintoma será exatamente esse.
 *
 * O nome vem do Next 16, que renomeou middleware para proxy. A função tem de se
 * chamar `proxy` (ou ser o export padrão).
 *
 * Tudo que é interno vive sob o primeiro segmento secreto (PAINEL_CHAVE). Quem
 * não sabe a chave nem chega aqui: o layout de `[entrada]/(interno)` devolve
 * 404, igual a qualquer endereço inexistente.
 *
 * A checagem de PAPEL (gestor x atendente) fica nos layouts, que já consultam o
 * banco — repetir aqui custaria uma ida ao banco por requisição.
 */
export async function proxy(request: NextRequest) {
  const chave = process.env.PAINEL_CHAVE ?? '';
  const caminho = request.nextUrl.pathname;

  if (!chave) return NextResponse.next({ request });

  const entrar = `/${chave}/entrar`;
  const interna = caminho.startsWith(`/${chave}/`);

  // ⚠️ O painel só existe no endereço DELE.
  //
  // Um candidato pode ter domínio próprio apontando para cá, e naquele host o
  // painel tem de ser indistinguível de nada — 404 seco, igual a qualquer
  // endereço inexistente. Sem esta linha o caminho certo devolvia 307 para a
  // tela de entrar e o errado devolvia 404, e essa diferença é a única coisa
  // que o segmento secreto precisava esconder.
  //
  // Vem ANTES de qualquer outra coisa porque o vazamento era o próprio
  // redirecionamento, não a página.
  if (interna && !hostEhDoPainel(request.headers.get('x-forwarded-host') ?? request.headers.get('host'))) {
    return new NextResponse(null, { status: 404 });
  }

  // Endereço público — a página de um candidato, por exemplo. Não há sessão
  // para renovar e `getUser()` é uma ida ao Supabase por visita. A página de
  // candidato é a mais acessada do sistema e é aberta por gente que nunca vai
  // ter conta: pagar autenticação nela seria pagar por nada.
  //
  // O pacote da extensão não é exceção aqui: ele deixou de ser arquivo em
  // `public/` e virou a rota `/{chave}/extensao`, que já cai em `interna` e
  // ainda confere a sessão por conta própria.
  if (!interna) return NextResponse.next({ request });

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
