import 'server-only';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { COOKIE_APARELHO, lerAparelho } from '@/lib/aparelho';

/**
 * Este aparelho foi revogado depois de liberado?
 *
 * ⚠️ Separado de `aparelho.ts` porque aquele roda no proxy, que é Edge e não
 * pode carregar `server-only` nem a chave de serviço. Aqui é Server Component,
 * onde as duas coisas existem.
 *
 * A resposta é cacheada por um minuto POR APARELHO: a pergunta se repete a cada
 * navegação da mesma pessoa, e a resposta quase nunca muda.
 *
 * ⚠️ O prazo real da revogação é "até um minuto MAIS uma navegação", e não um
 * minuto. `unstable_cache` serve o valor vencido uma vez e atualiza por trás —
 * então o primeiro clique depois do minuto ainda passa, e o seguinte é que
 * barra. Medido, não deduzido. Para o caso que motivou isto (atendente que saiu
 * da campanha, notebook perdido) essa folga não muda nada; se um dia precisar
 * ser imediato, o lugar de mexer é aqui, e o preço é uma consulta por navegação.
 */
const conferir = unstable_cache(
  async (id: string): Promise<boolean> => {
    const supabase = criarClienteAdmin();
    const { data, error } = await supabase.rpc('aparelho_ativo', { p_id: id });
    // ⚠️ Erro devolve "não revogado". Falhar para o lado de trancar faria uma
    // instabilidade do banco derrubar os quinze atendentes de uma vez — e esta
    // camada é obscuridade, não a tranca.
    if (error) return true;
    return data === true;
  },
  ['aparelho-ativo'],
  { revalidate: 60 },
);

export async function aparelhoFoiRevogado(): Promise<boolean> {
  const bruto = (await cookies()).get(COOKIE_APARELHO)?.value;
  const id = await lerAparelho(bruto);

  // Sem marca não há o que revogar: quem decide se isso barra ou não é o proxy,
  // que sabe se a trava está ligada.
  if (!id) return false;

  try {
    return !(await conferir(id));
  } catch {
    return false;
  }
}
