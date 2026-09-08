import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { ehChaveDoPainel } from '@/lib/rotas';
import { hostDaVisita, hostEhDeCandidato } from '@/lib/dominios-candidatos';
import { aparelhoFoiRevogado } from '@/lib/aparelho-servidor';

/**
 * Porta de entrada do painel.
 *
 * Tudo que é interno vive sob um primeiro segmento secreto. Se o segmento não
 * é a chave, a resposta é 404 — a MESMA resposta que qualquer endereço
 * inexistente recebe. Nada aqui pode indicar que existe um painel: nem um
 * redirecionamento para login, nem uma mensagem diferente, nem um código de
 * status distinto. Quem varre o domínio não deve conseguir separar
 * "endereço errado" de "endereço certo com chave errada".
 *
 * ⚠️ E o painel não responde no DOMÍNIO PRÓPRIO de um candidato. Aquele
 * endereço é divulgado, entra em post e vai no WhatsApp de milhares de pessoas:
 * é o endereço mais exposto que este sistema tem. Deixar o painel atender ali
 * daria à chave secreta uma segunda porta, num host que a campanha inteira
 * conhece — e ainda criaria uma sessão separada por domínio, que confunde quem
 * trabalha. No domínio do candidato existe a página do candidato e mais nada.
 */
/**
 * O ícone da aba do painel, desenhado aqui mesmo.
 *
 * ⚠️ Vem como `data:` de propósito, e não como arquivo.
 *
 * `src/app/favicon.ico` foi embora porque ícone declarado por ARQUIVO vence
 * ícone declarado em `metadata` — e enquanto ele existia, o triângulo padrão do
 * Next ganhava do ícone do candidato em todas as páginas. Um arquivo aqui
 * dentro também não serve: o segmento é dinâmico, então `/{qualquer-coisa}/icon`
 * responderia 200 para qualquer primeiro segmento, e a regra desta pasta é que
 * fora da chave tudo é 404.
 *
 * Sobra o `data:` — nenhum endereço novo, nenhuma requisição, e a marca do
 * sistema (lima sobre grafite) na aba de quem trabalha o dia inteiro com quinze
 * abas abertas. O `img-src` da política de conteúdo já libera `data:`.
 */
const ICONE_DO_PAINEL =
  'data:image/svg+xml,'
  + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">'
    + '<rect width="32" height="32" rx="8" fill="#121316"/>'
    + '<rect x="7" y="15" width="4.5" height="10" rx="2.25" fill="#c6f24e"/>'
    + '<rect x="13.75" y="10" width="4.5" height="15" rx="2.25" fill="#c6f24e"/>'
    + '<rect x="20.5" y="6" width="4.5" height="19" rx="2.25" fill="#c6f24e"/>'
    + '</svg>',
  );

// A identidade só existe daqui para dentro, embaixo do segmento secreto.
export const metadata: Metadata = {
  title: { default: 'Painel', template: '%s · Painel' },
  robots: { index: false, follow: false, nocache: true },
  icons: { icon: [{ url: ICONE_DO_PAINEL, type: 'image/svg+xml' }] },
};

export default async function PortaInterna({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  if (!ehChaveDoPainel(entrada)) notFound();

  // Falha para o lado de DEIXAR PASSAR. Se a consulta cair, o pior que pode
  // acontecer é o painel responder num endereço a mais; travar o painel inteiro
  // porque uma checagem acessória não respondeu seria muito pior.
  try {
    if (await hostEhDeCandidato(await hostDaVisita())) notFound();
  } catch {
    // segue
  }

  // ⚠️ A REVOGAÇÃO mora aqui, e não no proxy.
  //
  // O proxy confere só a assinatura do cookie, sem banco, porque roda em toda
  // requisição. Mas assinatura válida não quer dizer aparelho ainda autorizado:
  // o gestor pode ter revogado depois — atendente que saiu da campanha, notebook
  // perdido. Este layout já consulta o banco, então a checagem cabe aqui sem
  // custo novo, e vale no clique seguinte.
  if (await aparelhoFoiRevogado()) notFound();

  return children;
}
