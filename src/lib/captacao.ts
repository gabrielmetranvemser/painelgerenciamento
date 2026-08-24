import 'server-only';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { hashTelefone } from '@/lib/hmac';
import { montarLinhaEndereco, normalizarCep, type EnderecoEstruturado } from '@/lib/cep';
import { normalizarTelefone, type MotivoInvalido } from '@/lib/telefone';
import { primeiroNomeDe } from '@/lib/mensagem';

/**
 * Registro de quem se cadastrou por vontade própria — pelo site ou pedindo o
 * kit. Compartilhado pelas duas páginas de captação, porque a única diferença
 * entre elas é o formulário.
 *
 * Este é o caminho que o Doc 1 §7 chama de a peça mais valiosa do projeto:
 * troca lead ruim (lista fria) por lead bom (consentimento gravado, com data,
 * hora e IP), e o contato entra na fila QUENTE, atendida antes de tudo.
 *
 * ⚠️ É TAMBÉM a única porta do sistema aberta para a internet inteira. Tudo que
 * entra por aqui foi digitado por um desconhecido e não passou por login nenhum.
 * Duas regras saem disso e não se negociam:
 *
 *   1. Cadastro NÃO desfaz bloqueio. Ver `registrarCaptacao`, item 2.
 *   2. Toda resposta ao navegador é a MESMA — sucesso. Recusa por limite, por
 *      armadilha ou por bloqueio devolvem exatamente a tela de "obrigado", pelo
 *      mesmo motivo que `descadastrar_por_token` devolve igual para token que
 *      existe e token que não existe: resposta diferente vira oráculo, e um
 *      oráculo aqui responde "este número está na lista de bloqueio?".
 */

/** Cadastros que um mesmo IP pode fazer numa janela de 10 minutos. */
const LIMITE_POR_IP = 8;
const JANELA_MINUTOS = 10;

/**
 * Reenvio do mesmo número, para o mesmo candidato, dentro deste prazo, é
 * clique duplo — não cadastro novo. Curto de propósito: quem preencheu o
 * formulário e voltou depois para pedir também o material impresso precisa
 * conseguir.
 */
const REPIQUE_MS = 60_000;

export type DadosCaptacao = {
  origem: 'site' | 'kit';
  nome: string;
  telefone: string;
  municipioId: number;
  /** As partes do endereço. A linha para os relatórios é montada aqui. */
  endereco?: EnderecoEstruturado | null;
  tamanhoCamiseta?: string | null;
  itens?: string[] | null;
  /** De qual candidatura veio o cadastro. É o dono do lead. */
  candidatoId: string | null;
  /** A frase que a pessoa marcou, copiada no ato. É a prova do que foi aceito. */
  textoAceite: string;
  ip: string | null;
  userAgent: string | null;
};

export type ResultadoCaptacao =
  | { ok: true; primeiroNome: string }
  | { ok: false; erro: string };

const EXPLICACAO_TELEFONE: Record<MotivoInvalido, string> = {
  fixo: 'Esse é um telefone fixo. Precisamos de um celular com WhatsApp.',
  ddd_invalido: 'Esse DDD não existe. Confira o número.',
  curto: 'Faltam dígitos. Escreva com DDD, ex.: (69) 99999-0000.',
  longo: 'Número com dígitos demais. Confira.',
  formato: 'Esse número não parece um celular brasileiro.',
  vazio: 'Escreva seu WhatsApp com DDD.',
};

export async function registrarCaptacao(dados: DadosCaptacao): Promise<ResultadoCaptacao> {
  const telefone = normalizarTelefone(dados.telefone);
  if (!telefone.valido) {
    return { ok: false, erro: EXPLICACAO_TELEFONE[telefone.motivo] };
  }

  const supabase = criarClienteAdmin();
  const { hash, versao } = hashTelefone(telefone.chaveDedup);
  const primeiroNome = primeiroNomeDe(dados.nome);
  const obrigado: ResultadoCaptacao = { ok: true, primeiroNome: primeiroNome ?? dados.nome };

  // 0. Limite por IP. Vem antes de qualquer escrita: o ponto é não deixar uma
  //    enchente virar linha no banco nem contato na fila.
  const { data: tentativa } = await supabase.rpc('registrar_tentativa_captacao', {
    p_ip: dados.ip,
    p_limite: LIMITE_POR_IP,
    p_janela_min: JANELA_MINUTOS,
  });
  const limite = tentativa as { ok: boolean; contagem: number; primeira_recusa: boolean } | null;

  if (limite && !limite.ok) {
    // Um aviso por janela, não um por cadastro recusado: mil alertas iguais
    // escondem o alerta que importa.
    if (limite.primeira_recusa) {
      await supabase.from('alertas').insert({
        tipo: 'captacao_em_excesso',
        detalhe:
          `O IP ${dados.ip ?? 'desconhecido'} passou de ${LIMITE_POR_IP} cadastros em ` +
          `${JANELA_MINUTOS} minutos e os seguintes foram recusados. Pode ser uma enchente ` +
          'de leads falsos — confira a lista de contatos novos antes de os atendentes ' +
          'começarem o dia.',
      });
    }
    return obrigado;
  }

  // 0.1 Clique duplo. Nem grava de novo, nem responde diferente.
  //     `candidato_id` entra por `is` quando é nulo: no PostgREST, `eq.null`
  //     não casa com NULL nenhum e a trava passaria batido.
  const busca = supabase
    .from('captacoes')
    .select('id')
    .eq('chave_dedup', telefone.chaveDedup)
    .gte('criado_em', new Date(Date.now() - REPIQUE_MS).toISOString())
    .limit(1);

  const { data: repique } = await (dados.candidatoId
    ? busca.eq('candidato_id', dados.candidatoId)
    : busca.is('candidato_id', null));

  if (repique && repique.length > 0) return obrigado;

  // 1. O consentimento é gravado SEMPRE, com data, hora e IP. É a prova de que
  //    a pessoa pediu — o oposto exato da lista fria.
  const { data: captacao } = await supabase
    .from('captacoes')
    .insert({
      origem: dados.origem,
      nome: dados.nome,
      telefone_e164: telefone.e164,
      chave_dedup: telefone.chaveDedup,
      // O identificador que sobrevive à purga de 48h. É por ele que a purga
      // alcança esta linha e que o gestor liga um pedido à lista de bloqueio.
      telefone_hmac: hash,
      municipio_id: dados.municipioId,
      // A linha montada continua sendo gravada porque é o que o relatório, a
      // exportação e a busca de entregas leem — e é o que mantém os pedidos
      // antigos, de quando o campo era texto livre, na mesma lista dos novos.
      endereco: dados.endereco ? montarLinhaEndereco(dados.endereco) || null : null,
      cep: normalizarCep(dados.endereco?.cep),
      rua: dados.endereco?.rua?.trim() || null,
      numero: dados.endereco?.numero?.trim() || null,
      bairro: dados.endereco?.bairro?.trim() || null,
      tamanho_camiseta: dados.tamanhoCamiseta || null,
      itens: dados.itens?.length ? dados.itens : null,
      candidato_id: dados.candidatoId,
      texto_aceite: dados.textoAceite,
      ip: dados.ip,
      user_agent: dados.userAgent,
    })
    .select('id')
    .single();

  // 2. Estava bloqueado?
  //
  //    ⚠️ AQUI O SISTEMA PARA. Esta versão do código APAGAVA o bloqueio,
  //    entendendo que um cadastro novo é consentimento mais forte que o pedido
  //    de saída antigo. O raciocínio só se sustenta se quem preencheu for a
  //    dona do número — e este formulário não prova isso em lugar nenhum: não
  //    há código por SMS, não há confirmação, não há nada. Bastava saber o
  //    número de alguém para devolvê-lo à fila QUENTE, e envio depois do pedido
  //    de saída é multa POR MENSAGEM.
  //
  //    O cadastro continua gravado — é a prova de que alguém pediu, e é o que o
  //    gestor lê para decidir. Mas o contato não nasce, não volta para a fila e
  //    não autoriza candidato nenhum. Quem libera é o gestor, à mão, na tela de
  //    Suporte (`liberarBloqueio`).
  const { data: bloqueio } = await supabase
    .from('bloqueios')
    .select('telefone_hmac')
    .eq('telefone_hmac', hash)
    .maybeSingle();

  if (bloqueio) {
    await supabase.from('alertas').insert({
      tipo: 'optin_de_bloqueado',
      captacao_id: captacao?.id ?? null,
      detalhe:
        'Um número que pediu saída foi cadastrado de novo pelo formulário público. ' +
        'Ele continua bloqueado e NÃO entrou na fila. Se a pessoa realmente voltou a ' +
        'procurar a campanha, libere aqui; na dúvida, não libere — o cadastro sozinho ' +
        `não prova quem preencheu. (IP ${dados.ip ?? 'desconhecido'})`,
    });
    // Mesma resposta do sucesso: a tela não pode dizer se o número está ou não
    // na lista de bloqueio.
    return obrigado;
  }

  // 3. Contato na fila QUENTE. A busca é pelo HMAC, o único identificador que
  //    sobrevive à purga de 48h.
  const { data: existente } = await supabase
    .from('contatos')
    .select('id, status')
    .eq('telefone_hmac', hash)
    .maybeSingle();

  let contatoId = existente?.id ?? null;

  const comuns = {
    origem: dados.origem,
    nome: dados.nome,
    primeiro_nome: primeiroNome,
    telefone_e164: telefone.e164,
    chave_dedup: telefone.chaveDedup,
    municipio_id: dados.municipioId,
    // Dono do lead: a fila só entrega este contato a quem atende este candidato.
    ...(dados.candidatoId ? { candidato_origem_id: dados.candidatoId } : {}),
  };

  if (existente) {
    // Já conhecíamos o número. Promove para quente e devolve à fila — a menos
    // que já esteja com alguém ou já tenha desfecho: não se atropela conversa
    // em andamento nem se reabre quem já autorizou.
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
    const { data: novo } = await supabase
      .from('contatos')
      .insert({ ...comuns, telefone_hmac: hash, hmac_versao: versao, status: 'na_fila' })
      .select('id')
      .single();
    contatoId = novo?.id ?? null;
  }

  if (captacao && contatoId) {
    await supabase
      .from('captacoes')
      .update({ virou_contato: true, contato_id: contatoId })
      .eq('id', captacao.id);
  }

  // 4. O candidato pedido já entra na lista de quem pode alcançar esta pessoa.
  //
  //    Normalmente essa lista nasce quando o atendente manda a permissão. Aqui
  //    não precisa: a pessoa acabou de pedir o material DESTE candidato, por
  //    escrito, com data, hora e IP. Isso é consentimento mais forte que o
  //    "pode?" da conversa — exigir a permissão antes seria pedir de novo o que
  //    ela já deu.
  if (contatoId && dados.candidatoId) {
    await supabase
      .from('contato_candidato')
      .upsert(
        { contato_id: contatoId, candidato_id: dados.candidatoId },
        { onConflict: 'contato_id,candidato_id', ignoreDuplicates: true },
      );
  }

  return obrigado;
}

/** Primeiro IP da cadeia de proxies. */
export function ipDosCabecalhos(cabecalhos: Headers): string | null {
  const ip =
    cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    cabecalhos.get('x-real-ip')?.trim();
  return ip && ip.length > 0 ? ip : null;
}
