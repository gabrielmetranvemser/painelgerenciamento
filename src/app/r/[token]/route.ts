import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ehAcessoAutomatico } from '@/lib/bots';

export const dynamic = 'force-dynamic';

/**
 * Link rastreado.
 *
 * Um token aponta para exatamente um alvo:
 *   • uma PEÇA   → redireciona para a URL dela (santinho, vídeo, canal)
 *   • um CANDIDATO → redireciona para /m/{token}, a página que reúne as peças
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
    .select('token, candidato_id, materiais(url, ativo)')
    .eq('token', token)
    .maybeSingle();

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

  // O PostgREST devolve o relacionamento como lista mesmo sendo 1:1.
  const rel = (data as { materiais: { url: string; ativo: boolean }[] | { url: string; ativo: boolean } | null } | null)?.materiais;
  const peca = Array.isArray(rel) ? rel[0] : rel;

  // Peça desativada pelo gestor não redireciona para lugar nenhum: a página do
  // candidato mostra o que está no ar hoje.
  const destino = peca?.ativo ? peca.url : (data ? `/m/${token}` : null);

  // Token desconhecido (expirado, digitado errado, dado apagado) leva ao aviso
  // de privacidade em vez de a um erro seco.
  if (!destino) {
    return NextResponse.redirect(new URL('/privacidade', base), 302);
  }

  return NextResponse.redirect(
    destino.startsWith('/') ? new URL(destino, base) : new URL(destino),
    302,
  );
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
