'use server';

import { cookies, headers } from 'next/headers';
import { notFound, redirect } from 'next/navigation';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { assinarAparelho, COOKIE_APARELHO, hashDoCodigo, VALIDADE_DIAS } from '@/lib/aparelho';
import { hostEhDoPainel } from '@/lib/host-do-painel';
import { chavePainel } from '@/lib/rotas';

/**
 * O toque no botão: é AQUI que o convite é gasto e o navegador ganha a marca.
 *
 * ⚠️ Só por POST, nunca na abertura do link. Robô de pré-visualização abre o
 * link (GET) e não aperta botão — enquanto abrir bastava, o robô liberava a si
 * mesmo e queimava o convite antes da pessoa chegar.
 *
 * Qualquer defeito devolve 404, e sempre o mesmo: código errado, vencido, já
 * usado ou revogado respondem igual. Separar os motivos diria a quem está
 * tentando o que mudar na próxima.
 */
export async function liberarEsteAparelho(codigo: string): Promise<void> {
  const h = await headers();
  // Só no endereço do painel. No domínio de um candidato isto não existe.
  if (!hostEhDoPainel(h.get('x-forwarded-host') ?? h.get('host'))) notFound();
  if (!codigo || codigo.length < 20) notFound();

  const { data } = await criarClienteAdmin().rpc('usar_convite_aparelho', {
    p_codigo_hash: await hashDoCodigo(codigo),
    // Agora sai o navegador de quem tocou, não o do robô que abriu primeiro.
    p_user_agent: h.get('user-agent'),
  });

  const r = data as { ok: boolean; id?: string } | null;
  if (!r?.ok || !r.id) notFound();

  (await cookies()).set(COOKIE_APARELHO, await assinarAparelho(r.id), {
    httpOnly: true,
    // `lax` e não `strict`: com `strict` o cookie não acompanha a pessoa quando
    // ela chega ao painel por um link de fora, e ela veria 404 logo depois de
    // liberar — o defeito mais confuso possível.
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: VALIDADE_DIAS * 86_400,
  });

  // Quem leva ao painel é o servidor, depois de marcar o aparelho: a chave não
  // aparece no link nem na página do botão.
  redirect(`/${chavePainel()}/entrar`);
}
