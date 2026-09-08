import 'server-only';
import { unstable_cache } from 'next/cache';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ETIQUETA_CANDIDATOS } from '@/lib/cache';
import type { CargoEleitoral } from '@/lib/tipos-banco';

/**
 * O candidato como a internet inteira o vê.
 *
 * Morava dentro de `pagina.tsx`. Saiu de lá quando as rotas do ícone e do
 * cartão de compartilhamento passaram a precisar dos mesmos dados: importar a
 * página inteira dentro de uma rota de imagem arrastaria junto o formulário
 * (que é `'use client'`) para um lugar que nunca vai desenhar formulário
 * nenhum. Aqui os três compartilham a MESMA consulta cacheada — a página, o
 * cartão e o ícone de uma visita custam uma ida ao banco, não três.
 */

export type CandidatoPublico = {
  id: string; slug: string; nome_urna: string; cargo: CargoEleitoral; numero: string;
  partido_sigla: string | null; coligacao: string | null; cnpj_campanha: string | null;
  responsavel_material: string | null; slogan: string | null; chamada: string | null;
  cor_tema: string | null; cor_fundo: string | null; cor_superficie: string | null;
  foto_url: string | null; fundo_url: string | null;
  tema: 'auto' | 'claro' | 'escuro';
  ativo: boolean;
};

/**
 * ⚠️ Esta é a consulta da página mais aberta do sistema: qualquer pessoa da
 * internet a abre, ela não tem login e é o destino do botão no site de cada
 * candidato.
 *
 * Antes, cada visita disparava DUAS consultas com a chave de serviço — a do
 * candidato e a lista inteira dos 52 municípios, que não muda nunca. Numa
 * enxurrada de acessos (ou num ataque barato de recarregar a página), isso
 * esgota a conexão do banco e derruba junto o painel de quem está trabalhando.
 *
 * O cache é de DADOS, não de página: a página continua dinâmica, o que deixa de
 * ir ao banco é a consulta. Um minuto é o bastante para segurar rajada e curto
 * o bastante para o gestor ver a edição dele quase na hora — e as ações de
 * Candidatos invalidam a etiqueta na hora em que salvam, então nem esse minuto
 * costuma existir.
 */
export const buscarCandidatoPublico = unstable_cache(
  async (slug: string) => {
    const supabase = criarClienteAdmin();
    const { data } = await supabase
      .from('candidatos')
      .select(
        'id, slug, nome_urna, cargo, numero, partido_sigla, coligacao, cnpj_campanha, ' +
        'responsavel_material, slogan, chamada, cor_tema, cor_fundo, cor_superficie, ' +
        'foto_url, fundo_url, tema, ativo',
      )
      .eq('slug', slug)
      .maybeSingle();
    return (data as CandidatoPublico | null) ?? null;
  },
  ['candidato-publico'],
  { revalidate: 60, tags: [ETIQUETA_CANDIDATOS] },
);
