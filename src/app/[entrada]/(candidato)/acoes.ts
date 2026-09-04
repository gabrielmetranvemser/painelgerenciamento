'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ipDosCabecalhos, registrarCaptacao } from '@/lib/captacao';
import { ENDERECO_VAZIO, TAMANHOS_CAMISETA, normalizarCep, type EnderecoEstruturado } from '@/lib/cep';
import { textoDoAceite } from '@/lib/consentimento';
import { carregarItensKit } from '@/lib/acoes-itens-kit';
import { pedeTamanho } from '@/lib/itens-kit';
import { primeiroNomeDe } from '@/lib/mensagem';
import type { CargoEleitoral } from '@/lib/tipos-banco';

/** Campo de endereço que veio em branco chega como '' e deve virar null. */
const Texto = (max: number) =>
  z.string().trim().max(max).optional().transform((v) => (v ? v : null));

const Entrada = z.object({
  slug: z.string().trim().min(3).max(40),
  nome: z.string().trim().min(3, 'Escreva seu nome completo.').max(120),
  telefone: z.string().trim().min(8, 'Escreva seu WhatsApp com DDD.'),
  municipioId: z.coerce.number().int().positive('Escolha sua cidade.'),
  cep: Texto(9),
  rua: Texto(120),
  numero: Texto(20),
  bairro: Texto(80),
  tamanhoCamiseta: z.enum(TAMANHOS_CAMISETA).optional().nullable().catch(null),
  /**
   * A lista de itens é CADASTRO, não código — por isso `z.string()` com um
   * formato, e a conferência de quais existem fica logo abaixo, contra o banco.
   * Antes era um `z.enum` com os três escritos à mão aqui, e acrescentar um
   * item no cadastro fazia o formulário público recusá-lo em silêncio.
   */
  itens: z.array(z.string().regex(/^[a-z][a-z0-9_]{1,29}$/)),
  aceite: z.literal('on', { message: 'É preciso autorizar o contato pelo WhatsApp.' }),
  /**
   * Armadilha. O campo existe no HTML, fica escondido do olho e do leitor de
   * tela, e nenhuma pessoa consegue preenchê-lo. Robô preenche todo campo que
   * encontra — é assim que ele se identifica sozinho, sem CAPTCHA e sem o
   * eleitor perder um segundo.
   */
  apelido: z.string().max(200).optional(),
});

export type ResultadoCadastro =
  | {
      ok: true;
      nome: string;
      /**
       * Para onde levar a pessoa depois do "obrigado", com a mensagem já
       * escrita — ela é quem aperta enviar. `null` quando o candidato não tem
       * número de recepção: aí a tela só agradece, como sempre fez.
       */
      whatsapp: string | null;
    }
  | { ok: false; erro: string };

/**
 * Cadastro na página de um candidato.
 *
 * O candidato NÃO vem do formulário: vem do endereço, resolvido aqui no
 * servidor. Se viesse pelo formulário, bastaria trocar um campo no DevTools
 * para cadastrar o lead na conta de outra candidatura.
 *
 * Quem pede material impresso entra como 'kit' (tem endereço e itens); quem só
 * quer o material entra como 'site'. É a mesma distinção que os relatórios de
 * entrega já usam.
 */
export async function cadastrar(
  _anterior: ResultadoCadastro | null,
  form: FormData,
): Promise<ResultadoCadastro> {
  const analise = Entrada.safeParse({
    slug: form.get('slug'),
    nome: form.get('nome'),
    telefone: form.get('telefone'),
    municipioId: form.get('municipio_id'),
    cep: form.get('cep') ?? undefined,
    rua: form.get('rua') ?? undefined,
    numero: form.get('numero') ?? undefined,
    bairro: form.get('bairro') ?? undefined,
    tamanhoCamiseta: form.get('tamanho_camiseta') || null,
    itens: form.getAll('itens'),
    aceite: form.get('aceite'),
    apelido: form.get('apelido') ?? undefined,
  });

  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Confira os campos.' };
  }
  const d = analise.data;

  // Caiu na armadilha: devolve a MESMA tela de sucesso e não grava nada. Dizer
  // "recusado" ensinaria o robô a contornar no próximo cadastro.
  if (d.apelido && d.apelido.trim()) {
    // ⚠️ Sem `whatsapp`: quem caiu na armadilha não recebe número da campanha.
    // A tela é a mesma, mas entregar o número ao robô transformaria este
    // formulário numa lista de telefones da equipe servida de graça.
    return { ok: true, nome: primeiroNomeDe(d.nome) ?? d.nome, whatsapp: null };
  }

  const supabase = criarClienteAdmin();
  const { data: candidato } = await supabase
    .from('candidatos')
    .select('id, nome_urna, cargo, numero, ativo')
    .eq('slug', d.slug)
    .maybeSingle();

  if (!candidato?.ativo) {
    return { ok: false, erro: 'Esta página não está mais recebendo cadastros.' };
  }

  // ⚠️ Os itens são conferidos contra o CADASTRO, e não contra uma lista
  // escrita neste arquivo. O `regex` do schema garante só o formato da chave;
  // quem decide o que existe é a tabela `itens_kit`. Sem esta conferência,
  // qualquer chave bem-formada entraria em `captacoes.itens` pelo DevTools e
  // viraria uma linha de entrega que ninguém sabe o que é.
  const validos = await carregarItensKit();
  const itens = d.itens.filter((c) => validos.some((i) => i.chave === c));

  const querKit = itens.length > 0;
  const cabecalhos = await headers();

  // Sem item pedido não há entrega, e endereço guardado sem entrega para fazer
  // é dado pessoal que ninguém vai usar. Não grava.
  const endereco: EnderecoEstruturado = querKit
    ? { cep: normalizarCep(d.cep), rua: d.rua, numero: d.numero, bairro: d.bairro }
    : ENDERECO_VAZIO;

  const r = await registrarCaptacao({
    origem: querKit ? 'kit' : 'site',
    nome: d.nome,
    telefone: d.telefone,
    municipioId: d.municipioId,
    endereco,
    // Qual item pede tamanho também sai do cadastro: era `includes('camiseta')`
    // escrito à mão, e amanhã pode ser a camiseta e o boné.
    tamanhoCamiseta: pedeTamanho(itens, validos) ? d.tamanhoCamiseta ?? null : null,
    itens: querKit ? itens : null,
    candidatoId: candidato.id,
    candidatoNome: candidato.nome_urna,
    // Os rótulos, não as chaves: quem lê a mensagem é o atendente, e
    // "camiseta_branca" não é palavra que gente escreve.
    itensRotulos: itens.map((c) => validos.find((i) => i.chave === c)?.rotulo ?? c),
    textoAceite: textoDoAceite({
      nome_urna: candidato.nome_urna,
      cargo: candidato.cargo as CargoEleitoral,
      numero: candidato.numero,
    }),
    ip: ipDosCabecalhos(cabecalhos),
    userAgent: cabecalhos.get('user-agent'),
  });

  return r.ok
    ? { ok: true, nome: r.primeiroNome, whatsapp: r.whatsapp }
    : { ok: false, erro: r.erro };
}
