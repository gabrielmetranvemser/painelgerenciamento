import { buscarCandidatoPublico } from '@/lib/candidato-publico';
import { chegouPeloEnderecoAntigo } from '@/lib/dominios-candidatos';
import { iconeDoCandidato } from '@/lib/marca-imagens';
import { CABECALHOS_DA_MARCA, naoExiste } from '../compartilhado';

/**
 * O ícone da aba do navegador, do atalho na tela do celular e do favorito.
 *
 * ⚠️ Ele só chega ao navegador porque `src/app/favicon.ico` deixou de existir:
 * ícone declarado por ARQUIVO tem prioridade sobre ícone declarado em
 * `metadata`, e enquanto aquele arquivo estava lá o triângulo padrão do Next
 * ganhava desta rota em toda página do sistema.
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

  const imagem = await iconeDoCandidato(candidato);
  CABECALHOS_DA_MARCA.forEach(([chave, valor]) => imagem.headers.set(chave, valor));
  return imagem;
}
