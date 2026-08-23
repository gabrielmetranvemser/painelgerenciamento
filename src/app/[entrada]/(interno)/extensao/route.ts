import { NextResponse } from 'next/server';
import { criarClienteServidor } from '@/lib/supabase/server';
import { ehChaveDoPainel } from '@/lib/rotas';
import { pacoteDaExtensao } from '@/lib/extensao';

export const dynamic = 'force-dynamic';
// Precisa de sistema de arquivos para ler a pasta `extensao/`.
export const runtime = 'nodejs';

/**
 * Download do pacote da extensão.
 *
 * Duas travas, e nenhuma delas é o nome do arquivo:
 *
 *   1. o endereço tem de ser o segmento secreto — senão 404, igual a qualquer
 *      endereço inexistente
 *   2. tem de haver sessão — o zip carrega o endereço do painel dentro
 *
 * A resposta para quem não passa é 404, não 401 nem redirecionamento: de fora,
 * "não existe" e "existe mas você não entra" precisam ser a mesma coisa.
 */
export async function GET(
  _request: Request,
  ctx: { params: Promise<{ entrada: string }> },
) {
  const { entrada } = await ctx.params;
  if (!ehChaveDoPainel(entrada)) return naoEncontrado();

  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return naoEncontrado();

  const { data: perfil } = await supabase
    .from('usuarios').select('ativo').eq('id', user.id).maybeSingle();
  if (!perfil?.ativo) return naoEncontrado();

  try {
    const { nome, bytes } = await pacoteDaExtensao();
    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': 'application/zip',
        'Content-Disposition': `attachment; filename="${nome}"`,
        'Content-Length': String(bytes.length),
        // Leva o endereço do painel dentro: nada de cache compartilhado.
        'Cache-Control': 'private, no-store',
      },
    });
  } catch (erro) {
    const motivo = erro instanceof Error ? erro.message : 'falha ao montar o pacote';
    // Vai para o log do servidor: quem clica é o atendente, e a causa é sempre
    // de configuração — ele não tem o que fazer com a mensagem crua.
    console.error('[extensao] não consegui montar o pacote:', motivo);
    return new NextResponse(
      `Não consegui montar o pacote da extensão.\n\n${motivo}\n\n` +
        'Avise o gestor — é configuração do servidor, não do seu computador.',
      { status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  }
}

function naoEncontrado() {
  return new NextResponse('Página não encontrada.', {
    status: 404,
    headers: { 'Content-Type': 'text/plain; charset=utf-8' },
  });
}
