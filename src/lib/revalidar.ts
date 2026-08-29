import 'server-only';
import { revalidatePath } from 'next/cache';

/**
 * Revalida uma tela interna depois de uma Server Action.
 *
 * ⚠️ EXISTE POR CAUSA DE UM DEFEITO QUE PARECIA "não está salvando".
 *
 * Todo endereço interno vive embaixo do segmento secreto: a rota real é
 * `/[entrada]/gestor/configuracao`, e não `/gestor/configuracao`. As ações
 * chamavam `revalidatePath('/gestor/configuracao')` — um caminho que não casa
 * com rota nenhuma. O Next invalidava um cache que ninguém lê, a página não
 * era renderizada de novo, e o gestor via a tela continuar exibindo o valor
 * anterior depois de salvar. Ele concluiu, com razão, que o campo não gravava.
 *
 * Rota com segmento dinâmico exige o PADRÃO da rota (com os colchetes) mais o
 * tipo `'page'` — está em `node_modules/next/dist/docs/.../revalidatePath.md`:
 * "If `path` contains a dynamic segment (…) this parameter is required."
 *
 * Passe o caminho SEM o segmento: `revalidarInterno('/gestor/configuracao')`.
 */
export function revalidarInterno(...caminhos: string[]) {
  for (const caminho of caminhos) revalidatePath(`/[entrada]${caminho}`, 'page');
}
