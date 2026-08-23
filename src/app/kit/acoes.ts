'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { hashTelefone } from '@/lib/hmac';
import { normalizarTelefone } from '@/lib/telefone';
import { primeiroNomeDe } from '@/lib/mensagem';

const ITENS_VALIDOS = ['santinho', 'adesivo', 'camiseta'] as const;

const Entrada = z.object({
  nome: z.string().trim().min(3, 'Escreva seu nome completo.').max(120),
  telefone: z.string().trim().min(8, 'Escreva seu WhatsApp com DDD.'),
  municipioId: z.coerce.number().int().positive('Escolha sua cidade.'),
  endereco: z.string().trim().max(300).optional(),
  itens: z.array(z.enum(ITENS_VALIDOS)).min(1, 'Escolha pelo menos um item.'),
  aceite: z.literal('on', { message: 'É preciso autorizar o contato pelo WhatsApp.' }),
});

export type ResultadoKit = { ok: true; nome: string } | { ok: false; erro: string };

export async function pedirKit(_anterior: ResultadoKit | null, form: FormData): Promise<ResultadoKit> {
  const analise = Entrada.safeParse({
    nome: form.get('nome'),
    telefone: form.get('telefone'),
    municipioId: form.get('municipio_id'),
    endereco: form.get('endereco') ?? undefined,
    itens: form.getAll('itens'),
    aceite: form.get('aceite'),
  });

  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Confira os campos.' };
  }
  const dados = analise.data;

  const telefone = normalizarTelefone(dados.telefone);
  if (!telefone.valido) {
    const explicacao: Record<string, string> = {
      fixo: 'Esse é um telefone fixo. Precisamos de um número de celular com WhatsApp.',
      ddd_invalido: 'Esse DDD não existe. Confira o número.',
      curto: 'Faltam dígitos. Escreva com DDD, ex.: (69) 99999-0000.',
      longo: 'Número com dígitos demais. Confira.',
      formato: 'Esse número não parece um celular brasileiro.',
      vazio: 'Escreva seu WhatsApp com DDD.',
    };
    return { ok: false, erro: explicacao[telefone.motivo] ?? 'Confira o número.' };
  }

  const cabecalhos = await headers();
  const ip = cabecalhos.get('x-forwarded-for')?.split(',')[0]?.trim()
    || cabecalhos.get('x-real-ip')?.trim()
    || null;

  const supabase = criarClienteAdmin();
  const { hash, versao } = hashTelefone(telefone.chaveDedup);

  // 1. O registro de consentimento é gravado SEMPRE, com data, hora e IP.
  //    É a prova de que a pessoa pediu — o oposto da lista fria.
  const { data: captacao } = await supabase
    .from('captacoes')
    .insert({
      origem: 'kit',
      nome: dados.nome,
      telefone_e164: telefone.e164,
      chave_dedup: telefone.chaveDedup,
      municipio_id: dados.municipioId,
      endereco: dados.endereco || null,
      itens: dados.itens,
      ip,
      user_agent: cabecalhos.get('user-agent'),
    })
    .select('id')
    .single();

  // 2. Estava na lista de bloqueio?
  //
  //    Alguém que pediu saída antes e agora preenche este formulário está
  //    dando um consentimento NOVO, explícito, com data, hora e IP — evidência
  //    mais forte que o pedido antigo, e negar seria não entregar o que a
  //    pessoa está pedindo. Removemos o bloqueio e registramos um alerta, para
  //    o gestor conseguir auditar que isso aconteceu e por quê.
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
        `Número estava bloqueado e voltou por pedido de kit com aceite explícito ` +
        `(captação ${captacao?.id ?? '?'}, IP ${ip ?? 'desconhecido'}).`,
    });
  }

  // 3. Contato na fila QUENTE. Busca pelo HMAC, que é o único identificador que
  //    sobrevive à purga de 48h.
  const { data: existente } = await supabase
    .from('contatos')
    .select('id, status')
    .eq('telefone_hmac', hash)
    .maybeSingle();

  let contatoId = existente?.id ?? null;

  if (existente) {
    // Já conhecíamos o número. Promove para quente e devolve à fila, a menos
    // que já esteja com alguém ou já tenha desfecho — não se atropela uma
    // conversa em andamento nem se reabre quem já autorizou.
    const podeVoltar = ['na_fila', 'sem_resposta', 'perdido', 'pediu_saida'].includes(existente.status);
    await supabase
      .from('contatos')
      .update({
        origem: 'kit',
        nome: dados.nome,
        primeiro_nome: primeiroNomeDe(dados.nome),
        telefone_e164: telefone.e164,
        chave_dedup: telefone.chaveDedup,
        municipio_id: dados.municipioId,
        anonimizado_em: null,
        ...(podeVoltar ? { status: 'na_fila', resultado_em: null } : {}),
      })
      .eq('id', existente.id);
  } else {
    const { data: novo } = await supabase
      .from('contatos')
      .insert({
        origem: 'kit',
        nome: dados.nome,
        primeiro_nome: primeiroNomeDe(dados.nome),
        telefone_e164: telefone.e164,
        chave_dedup: telefone.chaveDedup,
        telefone_hmac: hash,
        hmac_versao: versao,
        municipio_id: dados.municipioId,
        status: 'na_fila',
      })
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

  return { ok: true, nome: primeiroNomeDe(dados.nome) ?? dados.nome };
}
