import 'server-only';

/**
 * Traz TODAS as linhas de uma consulta, em blocos.
 *
 * ⚠️ Existe por causa de um limite que não avisa. O PostgREST corta toda
 * resposta em `max_rows` — 1.000 neste projeto — e devolve as 1.000 primeiras
 * sem erro nenhum. Quem escreveu `.limit(50000)` recebeu 1.000 e não teve como
 * saber: o CSV "da base inteira" saía com um terço dela, e o único sinal era
 * alguém perceber que faltava gente na planilha.
 *
 * Por isso o avanço é pelo que VEIO, não pelo que foi pedido: se o teto do
 * projeto mudar para 500 ou para 10.000, esta função continua trazendo tudo.
 * Um laço que somasse o tamanho pedido pararia cedo e truncaria em silêncio —
 * que é exatamente o defeito que ela existe para consertar.
 *
 * Só para o SERVIDOR, e só para o que vai virar arquivo ou conta. Tela que
 * precisa de muitas linhas não usa isto: usa paginação de verdade, senão o
 * navegador recebe 30 mil linhas e trava.
 */

/** Tamanho do bloco pedido. Igual ao teto do projeto: uma ida por bloco. */
const BLOCO = 1000;

/** Trava de segurança: 500 blocos são 500 mil linhas. Laço infinito, não. */
const MAXIMO_DE_BLOCOS = 500;

type Resposta<T> = { data: T[] | null; error: { message: string } | null };

export async function buscarTudo<T>(
  consulta: (de: number, ate: number) => PromiseLike<Resposta<T>>,
): Promise<T[]> {
  const tudo: T[] = [];
  let de = 0;

  for (let bloco = 0; bloco < MAXIMO_DE_BLOCOS; bloco++) {
    const { data, error } = await consulta(de, de + BLOCO - 1);
    if (error) throw new Error(error.message);

    const linhas = data ?? [];
    if (linhas.length === 0) return tudo;

    tudo.push(...linhas);
    de += linhas.length;
  }

  throw new Error(
    `Consulta grande demais: parei em ${tudo.length.toLocaleString('pt-BR')} linhas. ` +
    'Se a base cresceu tanto assim, este relatório precisa de filtro.',
  );
}
