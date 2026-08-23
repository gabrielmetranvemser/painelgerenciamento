import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ehChaveDoPainel } from '@/lib/rotas';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Serve um print do suporte.
 *
 * O balde é PRIVADO, e por um motivo concreto: um print de conversa carrega
 * nome, telefone e o texto que o eleitor escreveu. Num balde público isso vira
 * uma URL que qualquer um abre e que não expira nunca.
 *
 * Quem decide é `posso_ver_anexo`: o dono do chamado e o gestor, mais ninguém.
 * O arquivo é entregue por esta rota, e não por link assinado devolvido ao
 * navegador — link assinado, uma vez na mão de alguém, sai andando por aí.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ entrada: string; id: string }> },
) {
  const { entrada, id } = await ctx.params;
  if (!ehChaveDoPainel(entrada)) return naoEncontrado();

  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('posso_ver_anexo', { p_anexo_id: id });
  if (error) return naoEncontrado();

  const r = data as { ok: boolean; caminho?: string };
  // Anexo que não existe e anexo que não é seu devolvem a MESMA coisa: saber
  // que um id existe já é saber que um chamado existe.
  if (!r?.ok || !r.caminho) return naoEncontrado();

  const admin = criarClienteAdmin();
  const { data: arquivo, error: erroBaixa } = await admin.storage
    .from('suporte')
    .download(r.caminho);
  if (erroBaixa || !arquivo) return naoEncontrado();

  return new NextResponse(arquivo.stream(), {
    headers: {
      'Content-Type': 'image/webp',
      // Dado pessoal: cache só no navegador de quem tem permissão, nunca na CDN.
      'Cache-Control': 'private, max-age=300',
      'Content-Disposition': 'inline',
    },
  });
}

function naoEncontrado() {
  return new NextResponse('Não encontrado.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
