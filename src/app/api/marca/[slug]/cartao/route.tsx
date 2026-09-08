import { buscarCandidatoPublico } from '@/lib/candidato-publico';
import { chegouPeloEnderecoAntigo } from '@/lib/dominios-candidatos';
import { cartaoDeCompartilhamento } from '@/lib/marca-imagens';
import { CABECALHOS_DA_MARCA, naoExiste } from '../compartilhado';

/**
 * A imagem que o WhatsApp desenha quando alguém cola o link do candidato.
 *
 * Quem a pede é um robô, não uma pessoa: ele lê `og:image` no HTML da página e
 * busca este endereço. Por isso a URL vem absoluta de `metadadosDoCandidato` —
 * robô não resolve caminho relativo.
 *
 * ⚠️ Segue o MESMO corte da página: candidato com domínio conferido não tem
 * mais nada respondendo no endereço da Vercel, nem imagem. É por isso que a
 * prévia no painel do gestor aponta para o domínio da campanha e não para o
 * host do painel — e, de quebra, uma prévia quebrada ali é o primeiro sinal de
 * que o domínio parou de responder.
 */
export const dynamic = 'force-dynamic';

export async function GET(
  _pedido: Request,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  const candidato = await buscarCandidatoPublico(slug);
  if (!candidato?.ativo) return naoExiste();
  if (await chegouPeloEnderecoAntigo({ slug })) return naoExiste();

  const imagem = await cartaoDeCompartilhamento(candidato);
  CABECALHOS_DA_MARCA.forEach(([chave, valor]) => imagem.headers.set(chave, valor));
  return imagem;
}
