import { NextResponse, type NextRequest } from 'next/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ehAcessoAutomatico } from '@/lib/bots';
import { chegouPeloEnderecoAntigo, dominioConferido, hostEhDeCandidato } from '@/lib/dominios-candidatos';

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

  const supabase = criarClienteAdmin();

  const { data } = await supabase
    .from('links')
    .select('token, candidato_id, materiais(url, ativo, candidato_id)')
    .eq('token', token)
    .maybeSingle();

  // O PostgREST devolve o relacionamento como lista mesmo sendo 1:1.
  type Peca = { url: string; ativo: boolean; candidato_id: string | null };
  const rel = (data as { materiais: Peca[] | Peca | null } | null)?.materiais;
  const peca = Array.isArray(rel) ? rel[0] : rel;

  const candidatoId =
    (data as { candidato_id: string | null } | null)?.candidato_id ?? peca?.candidato_id ?? null;

  // ⚠️ ESTA CHECAGEM VEM ANTES DE GRAVAR O CLIQUE, e a ordem é o ponto.
  //
  // Este link chegou pelo endereço antigo de um candidato que já tem domínio
  // próprio: ele morreu, e a pessoa vê 404. Gravar o clique seria pior que não
  // gravar — `cliques` é a prova de que alguém ABRIU o material, e quem bateu
  // numa página que não existe não abriu nada. Uma linha aqui inflaria
  // justamente o número que precisa ser defensável numa denúncia.
  if (candidatoId && (await chegouPeloEnderecoAntigo({ id: candidatoId }))) {
    return new NextResponse(null, { status: 404 });
  }

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

  // A base é resolvida DEPOIS de saber de quem é o token, e só é usada em
  // destino interno. A peça de material aponta para uma URL de fora (santinho,
  // vídeo, canal) — reescrever aquilo com o domínio da campanha produziria um
  // endereço que não existe.
  const base = await baseDoRedirecionamento(request, candidatoId);

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

/**
 * Para onde mandar quem clicou, quando o destino é uma página nossa.
 *
 * Quem abriu `material.sofiaandrade.com.br/r/abc` tem de continuar em
 * `material.sofiaandrade.com.br/m/abc`. Usar `LINK_BASE_URL` aqui devolveria a
 * pessoa ao endereço da Vercel no meio do caminho — o domínio da campanha
 * apareceria por um instante e sumiria, que é justamente o contrário do que ele
 * existe para fazer.
 *
 * ⚠️ E quem chegou pelo endereço ANTIGO é levado ao domínio da campanha, se o
 * candidato dono do token tiver um conferido. É o que faz o link de mil
 * conversas já enviadas terminar no endereço novo sem nenhum deles morrer — o
 * clique é gravado logo acima, antes do desvio, então a métrica não perde nada.
 *
 * Fora disso nada muda: `LINK_BASE_URL` continua tendo a palavra final, porque
 * atrás do proxy a origem da requisição nem sempre é o endereço público.
 */
async function baseDoRedirecionamento(
  request: NextRequest,
  candidatoId: string | null,
): Promise<string> {
  const bruto = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const host = bruto?.trim().toLowerCase().split(':')[0] ?? null;

  try {
    if (candidatoId) {
      const proprio = await dominioConferido({ id: candidatoId });
      if (proprio) return `https://${proprio}`;
    }
    if (host && (await hostEhDeCandidato(host))) return `https://${host}`;
  } catch {
    // Cai no padrão: um link no endereço da Vercel abre; um link quebrado não.
  }

  return process.env.LINK_BASE_URL || request.nextUrl.origin;
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
