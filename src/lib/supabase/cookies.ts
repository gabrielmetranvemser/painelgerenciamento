import type { CookieOptions } from '@supabase/ssr';

/**
 * Ajusta o cookie de sessão para funcionar dentro do painel lateral do Chrome.
 *
 * No painel lateral a página de topo é `chrome-extension://…`, então o painel
 * roda como conteúdo de terceiro e um cookie `SameSite=Lax` não é enviado — o
 * atendente veria a tela de login sem conseguir entrar.
 *
 * `SameSite=None` exige `Secure`. Em produção isso é automático. Em
 * desenvolvimento o padrão continua `Lax`, que é mais seguro — a menos que
 * você esteja testando a extensão contra o localhost, caso em que a sessão não
 * subiria dentro do painel lateral. Para esse caso, defina no .env.local:
 *
 *     PAINEL_LATERAL_LOCAL=1
 *
 * O Chrome aceita cookie `Secure` em http://localhost, então funciona.
 *
 * Sobre CSRF: afrouxar o SameSite normalmente preocuparia, mas aqui não abre
 * brecha. As Server Actions do Next validam a origem da requisição por conta
 * própria, e as poucas rotas GET que devolvem dado sensível (as exportações)
 * ficam protegidas pelo CORS — outro site consegue disparar a requisição, mas
 * não consegue ler a resposta.
 */
export function ajustarCookie(opcoes: CookieOptions = {}): CookieOptions {
  const precisa =
    process.env.NODE_ENV === 'production' || process.env.PAINEL_LATERAL_LOCAL === '1';
  if (!precisa) return opcoes;
  return { ...opcoes, sameSite: 'none', secure: true };
}
