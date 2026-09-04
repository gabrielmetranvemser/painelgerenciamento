'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { ROTULO_CARGO, type CargoEleitoral } from '@/lib/tipos-banco';

/**
 * Sem `revalidatePath` de propósito.
 *
 * Todas as telas do gestor são `force-dynamic`, então já buscam dados a cada
 * requisição — não há cache a invalidar. Invalidar o layout inteiro seria
 * trabalho jogado fora a cada gravação.
 *
 * Quem atualiza a tela depois da ação é o `router.refresh()` do componente.
 */

export type Resultado = { ok: true } | { ok: false; erro: string };

/**
 * Põe um candidato na chapa de um atendente.
 *
 * A regra "um candidato por cargo, dois senadores" é do banco
 * (`unique (atendente_id, cargo, vaga)`). Aqui a gente só traduz a violação
 * para uma frase útil: dizer "violação de restrição" não ajuda ninguém a saber
 * que já existe outro deputado federal e qual é.
 */
export async function atribuirCandidato(atendenteId: string, candidatoId: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const { data: cand } = await supabase
    .from('candidatos').select('cargo, vaga, nome_urna, ativo').eq('id', candidatoId).single();

  if (!cand) return { ok: false, erro: 'Candidato não encontrado.' };
  if (!cand.ativo) return { ok: false, erro: `${cand.nome_urna} está inativo. Reative antes de atribuir.` };

  // Já existe alguém neste cargo (e vaga)? Diz quem, para o gestor decidir.
  //
  // ⚠️ O embed precisa do NOME da chave estrangeira: há duas de
  // `atendente_candidatos` para `candidatos` (a simples e a composta que
  // sustenta o `unique (atendente_id, cargo, vaga)`), e sem desambiguar o
  // PostgREST devolve PGRST201. O erro era descartado, `ocupado` vinha nulo, e
  // esta checagem nunca disparava: quem tentasse trocar de candidato batia no
  // `unique` do banco e recebia o texto cru do Postgres.
  const { data: ocupado, error: erroOcupado } = await supabase
    .from('atendente_candidatos')
    .select('candidatos!atendente_candidatos_candidato_id_fkey(nome_urna)')
    .eq('atendente_id', atendenteId)
    .eq('cargo', cand.cargo)
    .eq('vaga', cand.vaga)
    .maybeSingle();

  if (erroOcupado) return { ok: false, erro: erroOcupado.message };

  if (ocupado) {
    // O PostgREST devolve o relacionamento como lista, mesmo sendo 1:1.
    const rel = (ocupado as unknown as { candidatos: { nome_urna: string }[] | { nome_urna: string } | null }).candidatos;
    const atual = Array.isArray(rel) ? rel[0]?.nome_urna : rel?.nome_urna;
    const cargo = ROTULO_CARGO[cand.cargo as CargoEleitoral];
    const vaga = cand.cargo === 'senador' ? ` (${cand.vaga}ª vaga)` : '';
    return {
      ok: false,
      erro:
        `Este atendente já atende ${atual ?? 'alguém'} para ${cargo}${vaga}. ` +
        'Cada atendente atende um candidato por cargo — senão a mesma pessoa receberia ' +
        'material de dois concorrentes ao mesmo cargo. Remova o atual antes de trocar.',
    };
  }

  // Se é o primeiro da chapa, já vira o principal: é o citado na Permissão, e
  // sem principal a mensagem sai sem dono.
  const { count } = await supabase
    .from('atendente_candidatos')
    .select('candidato_id', { count: 'exact', head: true })
    .eq('atendente_id', atendenteId);

  const { error } = await supabase.from('atendente_candidatos').insert({
    atendente_id: atendenteId,
    candidato_id: candidatoId,
    cargo: cand.cargo,
    vaga: cand.vaga,
    principal: (count ?? 0) === 0,
  });

  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

export async function removerDaChapa(atendenteId: string, candidatoId: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const { data: alvo } = await supabase
    .from('atendente_candidatos').select('principal')
    .eq('atendente_id', atendenteId).eq('candidato_id', candidatoId).maybeSingle();

  await supabase.from('atendente_candidatos')
    .delete().eq('atendente_id', atendenteId).eq('candidato_id', candidatoId);

  // Tirar o principal não pode deixar a chapa sem principal: a Permissão
  // ficaria sem o candidato que ela cita.
  if (alvo?.principal) {
    const { data: sobrou } = await supabase
      .from('atendente_candidatos').select('candidato_id')
      .eq('atendente_id', atendenteId).limit(1).maybeSingle();
    if (sobrou) {
      await supabase.from('atendente_candidatos').update({ principal: true })
        .eq('atendente_id', atendenteId).eq('candidato_id', sobrou.candidato_id);
    }
  }

  return { ok: true };
}

export async function definirPrincipal(atendenteId: string, candidatoId: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  // Tira o principal atual antes de pôr o novo: existe índice único garantindo
  // um só por atendente, e fazer na ordem inversa violaria.
  await supabase.from('atendente_candidatos')
    .update({ principal: false }).eq('atendente_id', atendenteId).eq('principal', true);

  const { error } = await supabase.from('atendente_candidatos')
    .update({ principal: true }).eq('atendente_id', atendenteId).eq('candidato_id', candidatoId);

  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/**
 * Quem recebe os cadastros que chegam pelo formulário deste candidato.
 *
 * ⚠️ A regra de quem recebe está no BANCO (`recebe_captacao_de`), não aqui:
 * cinco funções da fila fazem essa pergunta, e a resposta precisa ser a mesma
 * nas cinco. Esta ação só liga e desliga a marca.
 *
 * E vale lembrar o que a ausência de marca significa, porque é o contrário de
 * `atendente_listas`: com NINGUÉM marcado, o cadastro vai para a chapa inteira.
 * Não é esquecimento — é o que impede alguém que pediu material de ficar
 * parado na fila porque o gestor não marcou ninguém.
 */
export async function definirRecebeCaptacao(
  atendenteId: string,
  candidatoId: string,
  recebe: boolean,
): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const { error } = await supabase
    .from('atendente_candidatos')
    .update({ recebe_captacao: recebe })
    .eq('atendente_id', atendenteId)
    .eq('candidato_id', candidatoId);

  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}
