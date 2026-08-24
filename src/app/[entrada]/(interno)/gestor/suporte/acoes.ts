'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { criarClienteServidor } from '@/lib/supabase/server';

export type ResultadoAlerta = { ok: true; aviso?: string } | { ok: false; erro: string };

/** Tira o alerta da lista de "precisa de alguém". Não apaga: só marca resolvido. */
export async function resolverAlerta(id: number): Promise<ResultadoAlerta> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase
    .from('alertas')
    .update({ resolvido_em: new Date().toISOString() })
    .eq('id', id);
  if (error) return { ok: false, erro: error.message };
  return { ok: true };
}

/**
 * Libera um número da lista de bloqueio. É o ÚNICO caminho do sistema que
 * desfaz um bloqueio, e ele é manual de propósito.
 *
 * Dois alertas chegam até aqui, e o desfecho de cada um é diferente:
 *
 *   `optin_de_bloqueado`  alguém preencheu o formulário público com o número de
 *                         quem tinha pedido saída. Como o formulário não prova
 *                         quem preencheu, a pessoa volta para a FILA e é
 *                         abordada do começo.
 *
 *   `saida_para_revisar`  o atendente marcou "Pediu saída" e diz que foi
 *                         engano. Aqui existe uma conversa em andamento, então
 *                         a pessoa volta para o MESMO atendente, em atendimento
 *                         — devolvê-la à fila faria outra pessoa reabordar quem
 *                         já foi abordado.
 *
 * Bloqueio de origem 'landing' — a própria pessoa clicou em "não quero receber"
 * na página do material — não é liberado por nenhum dos dois. Ali quem falou foi
 * ela, pelo link que só ela recebeu.
 */
export async function liberarBloqueio(alertaId: number): Promise<ResultadoAlerta> {
  await exigirGestorOuFalhar();

  const sessao = await criarClienteServidor();
  const { data: { user } } = await sessao.auth.getUser();
  const { data: quem } = await sessao
    .from('usuarios').select('primeiro_nome').eq('id', user!.id).maybeSingle();

  const supabase = criarClienteAdmin();

  const { data: alerta } = await supabase
    .from('alertas')
    .select('id, tipo, detalhe, captacao_id, contato_id')
    .eq('id', alertaId)
    .maybeSingle();

  if (!alerta) return { ok: false, erro: 'Este alerta não existe mais.' };

  const resultado = alerta.captacao_id
    ? await liberarPeloCadastro(supabase, alerta.captacao_id)
    : alerta.contato_id
      ? await liberarPeloContato(supabase, alerta.contato_id)
      : { ok: false as const, erro: 'Este alerta não aponta para ninguém — não há o que liberar.' };

  if (!resultado.ok) return resultado;

  // O alerta vira o registro da decisão: quem liberou e quando. Por isso é
  // resolvido com o texto acrescentado, e não apagado.
  const carimbo = new Date().toLocaleString('pt-BR');
  await supabase
    .from('alertas')
    .update({
      resolvido_em: new Date().toISOString(),
      detalhe: `${alerta.detalhe ?? ''}\n→ Liberado por ${quem?.primeiro_nome ?? 'gestor'} em ${carimbo}.`,
    })
    .eq('id', alerta.id);

  return resultado;
}

type Admin = ReturnType<typeof criarClienteAdmin>;

/** Confere a lista de bloqueio e devolve o motivo quando não dá para liberar. */
async function apagarBloqueio(supabase: Admin, hmac: string): Promise<string | null> {
  const { data: bloqueio } = await supabase
    .from('bloqueios')
    .select('telefone_hmac, origem')
    .eq('telefone_hmac', hmac)
    .maybeSingle();

  if (bloqueio?.origem === 'landing') {
    return 'Quem pediu para sair foi a própria pessoa, clicando no link que só ela recebeu. ' +
      'Isso não se desfaz pelo painel — só ela pode voltar atrás, falando com alguém da equipe.';
  }
  if (bloqueio) await supabase.from('bloqueios').delete().eq('telefone_hmac', hmac);
  return null;
}

/** Cadastro pelo formulário público: a pessoa volta para a fila quente. */
async function liberarPeloCadastro(supabase: Admin, captacaoId: string): Promise<ResultadoAlerta> {
  const { data: cap } = await supabase
    .from('captacoes')
    .select('id, origem, nome, telefone_e164, chave_dedup, telefone_hmac, municipio_id, candidato_id')
    .eq('id', captacaoId)
    .maybeSingle();

  if (!cap) return { ok: false, erro: 'Este cadastro não existe mais.' };
  if (!cap.telefone_hmac) {
    return { ok: false, erro: 'Este cadastro é antigo e não tem como ser ligado à lista de bloqueio.' };
  }
  if (!cap.telefone_e164) {
    return {
      ok: false,
      erro: 'Os dados deste cadastro já foram apagados pela purga de 48h. Não há telefone para liberar.',
    };
  }

  const impedimento = await apagarBloqueio(supabase, cap.telefone_hmac);
  if (impedimento) return { ok: false, erro: impedimento };

  const { data: existente } = await supabase
    .from('contatos')
    .select('id, status')
    .eq('telefone_hmac', cap.telefone_hmac)
    .maybeSingle();

  const comuns = {
    origem: cap.origem,
    nome: cap.nome,
    telefone_e164: cap.telefone_e164,
    chave_dedup: cap.chave_dedup,
    municipio_id: cap.municipio_id,
    ...(cap.candidato_id ? { candidato_origem_id: cap.candidato_id } : {}),
  };

  let contatoId = existente?.id ?? null;

  if (existente) {
    // Conversa em andamento com outro atendente não se atropela; o resto volta.
    const podeVoltar = ['na_fila', 'sem_resposta', 'perdido', 'pediu_saida'].includes(existente.status);
    await supabase
      .from('contatos')
      .update({
        ...comuns,
        anonimizado_em: null,
        ...(podeVoltar ? { status: 'na_fila', resultado_em: null } : {}),
      })
      .eq('id', existente.id);
  } else {
    const { data: novo, error } = await supabase
      .from('contatos')
      .insert({ ...comuns, telefone_hmac: cap.telefone_hmac, hmac_versao: 1, status: 'na_fila' })
      .select('id')
      .single();
    if (error) return { ok: false, erro: error.message };
    contatoId = novo?.id ?? null;
  }

  if (contatoId) {
    await supabase
      .from('captacoes')
      .update({ virou_contato: true, contato_id: contatoId })
      .eq('id', cap.id);

    if (cap.candidato_id) {
      await supabase
        .from('contato_candidato')
        .upsert(
          { contato_id: contatoId, candidato_id: cap.candidato_id },
          { onConflict: 'contato_id,candidato_id', ignoreDuplicates: true },
        );
    }
  }

  return { ok: true, aviso: 'Número liberado. A pessoa voltou para a fila quente.' };
}

/**
 * Engano do atendente: a pessoa volta para a conversa que já estava
 * acontecendo, com quem já estava falando com ela.
 */
async function liberarPeloContato(supabase: Admin, contatoId: string): Promise<ResultadoAlerta> {
  const { data: contato } = await supabase
    .from('contatos')
    .select('id, status, telefone_hmac, atendente_id, chip_id, anonimizado_em')
    .eq('id', contatoId)
    .maybeSingle();

  if (!contato) return { ok: false, erro: 'Este contato não existe mais.' };
  if (contato.anonimizado_em) {
    return {
      ok: false,
      erro: 'Os dados desta pessoa já foram apagados pela purga de 48h. Não há o que restaurar.',
    };
  }
  if (!contato.atendente_id) {
    return { ok: false, erro: 'Este contato não está com ninguém. Não há conversa para retomar.' };
  }

  const impedimento = await apagarBloqueio(supabase, contato.telefone_hmac);
  if (impedimento) return { ok: false, erro: impedimento };

  const { data: cfg } = await supabase
    .from('config').select('lease_minutos').eq('id', 1).maybeSingle();
  const minutos = cfg?.lease_minutos ?? 20;

  const { error } = await supabase
    .from('contatos')
    .update({
      status: 'em_atendimento',
      resultado_em: null,
      claimed_at: new Date().toISOString(),
      claim_expira_em: new Date(Date.now() + minutos * 60_000).toISOString(),
    })
    .eq('id', contato.id);
  if (error) return { ok: false, erro: error.message };

  return {
    ok: true,
    aviso: 'Número liberado. A conversa voltou para o mesmo atendente, em atendimento.',
  };
}
