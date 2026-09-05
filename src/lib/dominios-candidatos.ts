import 'server-only';
import { unstable_cache } from 'next/cache';
import { headers } from 'next/headers';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ETIQUETA_CANDIDATOS } from '@/lib/cache';

/**
 * De qual candidato é o endereço pelo qual esta visita chegou.
 *
 * Um candidato pode ter um domínio próprio (`material.sofiaandrade.com.br`)
 * apontando para cá. A página dele responde nos DOIS endereços — o da Vercel e
 * o próprio — e nada é migrado: o link que já foi enviado a alguém está no
 * WhatsApp daquela pessoa para sempre, e precisa continuar abrindo.
 *
 * ⚠️ A consulta é CACHEADA porque roda na página mais aberta do sistema. Sem
 * cache, cada visita da internet inteira viraria uma ida ao banco com a chave
 * de serviço — o mesmo problema que a página do candidato já tinha resolvido.
 * A etiqueta é a mesma que Gestor → Candidatos derruba ao salvar, então o
 * gestor não espera o minuto para ver o que acabou de cadastrar.
 */
type Registro = {
  id: string;
  slug: string;
  dominio: string;
  /** Nulo enquanto o painel não confirmou que este host responde por ele. */
  dominio_verificado_em: string | null;
};

const carregar = unstable_cache(
  async (): Promise<Registro[]> => {
    const supabase = criarClienteAdmin();
    const { data } = await supabase
      .from('candidatos')
      .select('id, slug, dominio, dominio_verificado_em')
      .not('dominio', 'is', null);
    return (data as Registro[] | null) ?? [];
  },
  ['dominios-de-candidato'],
  { revalidate: 60, tags: [ETIQUETA_CANDIDATOS] },
);

/**
 * O host da requisição, do jeito que é comparável com a coluna: minúsculo e
 * sem porta. `x-forwarded-host` vem primeiro porque é o que a Vercel preenche
 * com o domínio que a pessoa realmente digitou.
 */
export async function hostDaVisita(): Promise<string | null> {
  const h = await headers();
  const bruto = h.get('x-forwarded-host') ?? h.get('host');
  if (!bruto) return null;
  return bruto.trim().toLowerCase().split(':')[0] || null;
}

/**
 * O candidato dono deste host, ou `null`.
 *
 * ⚠️ Responde mesmo com o domínio AINDA NÃO VERIFICADO, de propósito: a
 * verificação funciona abrindo o endereço e perguntando de quem ele é. Exigir
 * verificação aqui seria exigir que o domínio já estivesse verificado para
 * poder ser verificado.
 */
export async function candidatoPorDominio(
  host: string | null,
): Promise<{ id: string; slug: string } | null> {
  if (!host) return null;
  const achado = (await carregar()).find((c) => c.dominio === host);
  return achado ? { id: achado.id, slug: achado.slug } : null;
}

/** `true` quando este host é o domínio próprio de algum candidato. */
export async function hostEhDeCandidato(host: string | null): Promise<boolean> {
  return (await candidatoPorDominio(host)) !== null;
}

/**
 * O endereço base a usar nos links DESTE candidato, ou `null` para "use o
 * padrão do sistema".
 *
 * Só devolve algo depois de verificado. Entre digitar o domínio e o DNS
 * responder existem horas, e link que não abre dentro de uma mensagem de
 * WhatsApp é um prejuízo silencioso: o envio é registrado, o clique nunca
 * chega, e a campanha perde a única prova de que aquela pessoa abriu.
 */
export async function enderecoDoCandidato(candidatoId: string): Promise<string | null> {
  const achado = (await carregar()).find(
    (c) => c.id === candidatoId && c.dominio_verificado_em !== null,
  );
  return achado ? `https://${achado.dominio}` : null;
}

/**
 * O domínio próprio JÁ CONFERIDO deste candidato, por id ou por apelido.
 *
 * ⚠️ É a mesma trava de `enderecoDoCandidato`: domínio digitado e não conferido
 * não vale. Aqui a consequência de ignorar isso seria pior — mandar quem abriu
 * um link antigo para um endereço que ainda não responde transformaria um link
 * que funcionava num link morto.
 */
export async function dominioConferido(
  chave: { id?: string; slug?: string },
): Promise<string | null> {
  const achado = (await carregar()).find(
    (c) => c.dominio_verificado_em !== null
      && ((chave.id && c.id === chave.id) || (chave.slug && c.slug === chave.slug)),
  );
  return achado?.dominio ?? null;
}

/**
 * Esta visita chegou pelo endereço ANTIGO de um candidato que já tem domínio
 * próprio?
 *
 * ⚠️ O corte é pelo HOST, e não pelo token, e isso não é detalhe de
 * implementação — é a única forma que funciona.
 *
 * O token de um material é o MESMO para sempre (`garantir_link_material`
 * reaproveita por contato e peça). O link que a pessoa recebeu há três dias no
 * endereço da Vercel e o que ela recebe hoje no domínio da campanha carregam o
 * mesmo `/r/abc123`. Desligar "os links antigos" pelo token desligaria os novos
 * junto, para a mesma pessoa. O que morre é o ENDEREÇO velho, não o token.
 *
 * Consequência boa: reenviar o material pela ficha do contato já devolve um
 * link que funciona, sem nada de especial — o texto é montado de novo, agora
 * com o domínio da campanha.
 *
 * ⚠️ E a saída de emergência: isto só vale enquanto existe domínio CONFERIDO.
 * Se o domínio da campanha cair, apagar o campo em Candidatos devolve tudo ao
 * endereço da Vercel na hora — sem deploy, sem migration. É o botão de pânico
 * desta decisão, e é de propósito que ele seja um campo de texto que o gestor
 * alcança sozinho.
 */
export async function chegouPeloEnderecoAntigo(
  chave: { id?: string; slug?: string },
): Promise<boolean> {
  const dominio = await dominioConferido(chave);
  if (!dominio) return false;
  return (await hostDaVisita()) !== dominio;
}
