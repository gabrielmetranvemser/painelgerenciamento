import type { CookieOptions } from '@supabase/ssr';

/**
 * Ajusta o cookie de sessão para funcionar dentro do painel lateral do Chrome.
 *
 * No painel lateral a página de topo é `chrome-extension://…`, então o painel
 * roda como conteúdo de terceiro e um cookie `SameSite=Lax` não é enviado — o
 * atendente veria a tela de login sem conseguir entrar.
 *
 * `SameSite=None` exige `Secure`, que não existe em http://localhost. Por isso
 * a troca só vale em produção; em desenvolvimento o padrão `Lax` continua.
 *
 * Sobre CSRF: afrouxar o SameSite normalmente preocuparia, mas aqui não abre
 * brecha. As Server Actions do Next validam a origem da requisição por conta
 * própria, e as poucas rotas GET que devolvem dado sensível (as exportações)
 * ficam protegidas pelo CORS — outro site consegue disparar a requisição, mas
 * não consegue ler a resposta.
 */
export function ajustarCookie(opcoes: CookieOptions = {}): CookieOptions {
  if (process.env.NODE_ENV !== 'production') return opcoes;
  return { ...opcoes, sameSite: 'none', secure: true };
}
