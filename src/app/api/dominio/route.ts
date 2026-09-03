import { NextResponse, type NextRequest } from 'next/server';
import { candidatoPorDominio } from '@/lib/dominios-candidatos';

export const dynamic = 'force-dynamic';

/**
 * De quem é este endereço.
 *
 * Existe por um motivo só: o gestor cadastra o domínio próprio de um candidato
 * e o painel precisa CONFERIR, sozinho, que ele funciona antes de começar a
 * mandar links nele. A conferência abre este endereço de fora e compara o que
 * volta com o candidato que está sendo editado — o que prova, de uma vez, que o
 * DNS aponta para cá, que o certificado foi emitido e que o host está
 * cadastrado para aquele candidato.
 *
 * Sem isso, o gestor digitaria o domínio, salvaria, e as mensagens do dia
 * sairiam com um link que só passa a existir quando o DNS propagar — horas
 * depois, e sem ninguém perceber, porque o envio é registrado do mesmo jeito.
 *
 * ⚠️ Em qualquer host que NÃO seja domínio de candidato — o endereço da Vercel
 * inclusive — a resposta é 404, igual a qualquer endereço inexistente. Este
 * endereço não é um índice de domínios cadastrados.
 */
export async function GET(request: NextRequest) {
  const bruto = request.headers.get('x-forwarded-host') ?? request.headers.get('host');
  const host = bruto?.trim().toLowerCase().split(':')[0] ?? null;

  const candidato = await candidatoPorDominio(host);
  if (!candidato) return new NextResponse(null, { status: 404 });

  // Só o apelido público, que já está na URL de quem abre a página. Nada de id.
  return NextResponse.json(
    { host, slug: candidato.slug },
    { headers: { 'cache-control': 'no-store' } },
  );
}
