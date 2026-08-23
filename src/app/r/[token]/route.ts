import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ehAcessoAutomatico } from '@/lib/bots';

export const dynamic = 'force-dynamic';

/**
 * Link rastreado.
 *
 * Registra o acesso e redireciona para o destino atual — o gestor troca a URL
 * de destino sem invalidar os tokens já enviados.
 *
 * ⚠️ O clique é a única métrica que o sistema controla de verdade e a prova de
 * consentimento (docs/01-VISAO-GERAL.md §8). Por isso o `is_bot`: ao enviar a
 * mensagem, o WhatsApp busca esta URL sozinho para montar a pré-visualização.
 * Sem o filtro, TODO contato apareceria como "clicou" no segundo seguinte ao
 * envio. Gravamos tudo (ajuda a depurar) e os relatórios contam só is_bot=false.
 */
async function tratar(request: NextRequest, ctx: { params: Promise<{ token: string }> }) {
  const { token } = await ctx.params;
  const base = process.env.LINK_BASE_URL || request.nextUrl.origin;

  const supabase = criarClienteAdmin();

  const { data } = await supabase
    .from('links')
    .select('token, destinos(url)')
    .eq('token', token)
    .maybeSingle();

  const destino = (data as { destinos: { url: string } | null } | null)?.destinos?.url ?? null;

  const isBot = ehAcessoAutomatico({
    userAgent: request.headers.get('user-agent'),
    metodo: request.method,
  });

  if (data) {
    // Um insert, aguardado: em serverless, promessa não aguardada pode morrer
    // com o processo antes de chegar ao banco.
    await supabase.from('cliques').insert({
      token,
      is_bot: isBot,
      ip: primeiroIp(request),
      user_agent: request.headers.get('user-agent'),
      referer: request.headers.get('referer'),
    });
  }

  // Token desconhecido (expirado, digitado errado, dado apagado) leva ao aviso
  // de privacidade em vez de a um erro seco.
  if (!destino) {
    return NextResponse.redirect(new URL('/privacidade', base), 302);
  }

  const url = destino.includes('{token}')
    ? destino.replace('{token}', encodeURIComponent(token))
    : destino;

  return NextResponse.redirect(url.startsWith('/') ? new URL(url, base) : new URL(url), 302);
}

/** Primeiro IP da cadeia de proxies. Null quando não dá para determinar. */
function primeiroIp(request: NextRequest): string | null {
  const encaminhado = request.headers.get('x-forwarded-for');
  const ip = encaminhado?.split(',')[0]?.trim() || request.headers.get('x-real-ip')?.trim();
  return ip && ip.length > 0 ? ip : null;
}

export const GET = tratar;
// HEAD é sempre máquina, mas registramos igual, marcado como bot.
export const HEAD = tratar;
