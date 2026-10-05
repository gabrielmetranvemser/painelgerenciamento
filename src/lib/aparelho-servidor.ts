import 'server-only';
import { cookies } from 'next/headers';
import { unstable_cache } from 'next/cache';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { COOKIE_APARELHO, hashDoCodigo, lerAparelho } from '@/lib/aparelho';

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

/**
 * O aparelho deste navegador — liberado e não revogado — ou `null`.
 *
 * ⚠️ Sem cache e sem tolerância, ao contrário de `aparelhoFoiRevogado`. Quem
 * pergunta isto está prestes a LIGAR a trava, e aqui o erro barato é o
 * oposto: na dúvida responde "não liberado" e a trava não liga. Ligar com a
 * resposta errada tranca o gestor para fora do painel — inclusive da tela que
 * desliga a trava.
 */
export async function aparelhoDesteNavegador(): Promise<string | null> {
  const id = await lerAparelho((await cookies()).get(COOKIE_APARELHO)?.value);
  if (!id) return null;

  try {
    const { data, error } = await criarClienteAdmin().rpc('aparelho_ativo', { p_id: id });
    return !error && data === true ? id : null;
  } catch {
    return null;
  }
}

/**
 * O convite ainda serve? Só PERGUNTA — não gasta.
 *
 * ⚠️ Existe porque abrir o link deixou de liberar. Mensageiro abre o link
 * sozinho para montar a pré-visualização, e enquanto a liberação acontecia na
 * abertura o robô gastava o convite antes da pessoa: em 04/10 um "Chrome 56 no
 * Linux" usou o link 15 segundos depois de gerado, o painel contou "1 aparelho
 * liberado", aceitou ligar a trava e trancou o gestor para fora. Agora a página
 * só mostra o botão, e quem gasta o convite é o toque (`usar_convite_aparelho`).
 *
 * Isto só decide entre mostrar o botão e devolver 404. A palavra final é da
 * RPC, no toque: se o convite vencer entre abrir e tocar, a pessoa vê o mesmo
 * 404 de qualquer convite vencido.
 */
export async function conviteDeAparelhoValido(codigo: string): Promise<boolean> {
  if (!codigo || codigo.length < 20) return false;

  try {
    const { data, error } = await criarClienteAdmin()
      .from('aparelhos')
      .select('id')
      .eq('codigo_hash', await hashDoCodigo(codigo))
      .is('revogado_em', null)
      .gt('expira_em', new Date().toISOString())
      .maybeSingle();
    return !error && data !== null;
  } catch {
    return false;
  }
}
