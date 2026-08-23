import 'server-only';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { hashTelefone } from '@/lib/hmac';
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
 */

export type DadosCaptacao = {
  origem: 'site' | 'kit';
  nome: string;
  telefone: string;
  municipioId: number;
  endereco?: string | null;
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

  // 1. O consentimento é gravado SEMPRE, com data, hora e IP. É a prova de que
  //    a pessoa pediu — o oposto exato da lista fria.
  const { data: captacao } = await supabase
    .from('captacoes')
    .insert({
      origem: dados.origem,
      nome: dados.nome,
      telefone_e164: telefone.e164,
      chave_dedup: telefone.chaveDedup,
      municipio_id: dados.municipioId,
      endereco: dados.endereco || null,
      itens: dados.itens?.length ? dados.itens : null,
      candidato_id: dados.candidatoId,
      texto_aceite: dados.textoAceite,
      ip: dados.ip,
      user_agent: dados.userAgent,
    })
    .select('id')
    .single();

  // 2. Estava bloqueado?
  //    Quem pediu saída antes e agora preenche o formulário está dando um
  //    consentimento NOVO, explícito, com data, hora e IP — evidência mais
  //    forte que o pedido antigo, e negar seria não entregar o que a pessoa
  //    está pedindo agora. Removemos o bloqueio e deixamos alerta para o gestor
  //    conseguir auditar que isso aconteceu.
  const { data: bloqueio } = await supabase
    .from('bloqueios')
    .select('telefone_hmac')
    .eq('telefone_hmac', hash)
    .maybeSingle();

  if (bloqueio) {
    await supabase.from('bloqueios').delete().eq('telefone_hmac', hash);
    await supabase.from('alertas').insert({
      tipo: 'bloqueio_removido_por_optin',
      detalhe:
        `Número estava bloqueado e voltou por cadastro próprio com aceite ` +
        `explícito (captação ${captacao?.id ?? '?'}, IP ${dados.ip ?? 'desconhecido'}).`,
    });
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

  return { ok: true, primeiroNome: primeiroNome ?? dados.nome };
}

/** Primeiro IP da cadeia de proxies. */
export function ipDosCabecalhos(cabecalhos: Headers): string | null {
  const ip =
    cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim() ||
    cabecalhos.get('x-real-ip')?.trim();
  return ip && ip.length > 0 ? ip : null;
}
