import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { assinarAparelho, COOKIE_APARELHO, hashDoCodigo, VALIDADE_DIAS } from '@/lib/aparelho';
import { hostEhDoPainel } from '@/lib/host-do-painel';
import { chavePainel } from '@/lib/rotas';

export const dynamic = 'force-dynamic';

/**
 * Libera este navegador.
 *
 * ⚠️ O endereço é NEUTRO de propósito: `/a/{codigo}`, e não algo embaixo do
 * segmento secreto. O gestor manda este link por WhatsApp, e um link que
 * carregasse a chave a espalharia por toda conversa — exatamente o que a chave
 * existe para evitar. Quem abre não vê a chave em lugar nenhum: quem redireciona
 * para o painel é o servidor, depois de marcar o aparelho.
 *
 * ⚠️ Fica FORA do portão do proxy (não começa com a chave), senão ninguém
 * conseguiria liberar o primeiro aparelho — a trava impediria a própria porta
 * de entrada.
 *
 * Qualquer defeito devolve 404, e sempre o mesmo: código errado, vencido, já
 * usado ou revogado respondem igual. Separar os motivos diria a quem está
 * tentando o que mudar na próxima.
 */
export async function GET(request: NextRequest, ctx: { params: Promise<{ codigo: string }> }) {
  const naoExiste = new NextResponse(null, { status: 404 });

  // Só no endereço do painel. No domínio de um candidato isto não existe.
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  if (!hostEhDoPainel(host)) return naoExiste;

  const { codigo } = await ctx.params;
  if (!codigo || codigo.length < 20) return naoExiste;

  const supabase = criarClienteAdmin();
  const { data } = await supabase.rpc('usar_convite_aparelho', {
    p_codigo_hash: await hashDoCodigo(codigo),
    p_user_agent: request.headers.get('user-agent'),
  });

  const r = data as { ok: boolean; id?: string } | null;
  if (!r?.ok || !r.id) return naoExiste;

  const destino = new URL(`/${chavePainel()}/entrar`, request.nextUrl.origin);
  const resposta = NextResponse.redirect(destino, 302);

  resposta.cookies.set(COOKIE_APARELHO, await assinarAparelho(r.id), {
    httpOnly: true,
    // `lax` e não `strict`: com `strict` o cookie não acompanha a pessoa quando
    // ela chega ao painel por um link de fora, e ela veria 404 logo depois de
    // liberar — o defeito mais confuso possível.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VALIDADE_DIAS * 86_400,
  });

  return resposta;
}
