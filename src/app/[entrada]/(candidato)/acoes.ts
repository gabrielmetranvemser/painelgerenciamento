'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ipDosCabecalhos, registrarCaptacao } from '@/lib/captacao';
import { textoDoAceite } from '@/lib/consentimento';
import type { CargoEleitoral } from '@/lib/tipos-banco';

const ITENS_VALIDOS = ['santinho', 'adesivo', 'camiseta'] as const;

const Entrada = z.object({
  slug: z.string().trim().min(3).max(40),
  nome: z.string().trim().min(3, 'Escreva seu nome completo.').max(120),
  telefone: z.string().trim().min(8, 'Escreva seu WhatsApp com DDD.'),
  municipioId: z.coerce.number().int().positive('Escolha sua cidade.'),
  endereco: z.string().trim().max(300).optional(),
  itens: z.array(z.enum(ITENS_VALIDOS)),
  aceite: z.literal('on', { message: 'É preciso autorizar o contato pelo WhatsApp.' }),
});

export type ResultadoCadastro = { ok: true; nome: string } | { ok: false; erro: string };

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
    endereco: form.get('endereco') ?? undefined,
    itens: form.getAll('itens'),
    aceite: form.get('aceite'),
  });

  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Confira os campos.' };
  }
  const d = analise.data;

  const supabase = criarClienteAdmin();
  const { data: candidato } = await supabase
    .from('candidatos')
    .select('id, nome_urna, cargo, numero, ativo')
    .eq('slug', d.slug)
    .maybeSingle();

  if (!candidato?.ativo) {
    return { ok: false, erro: 'Esta página não está mais recebendo cadastros.' };
  }

  const querKit = d.itens.length > 0;
  const cabecalhos = await headers();

  const r = await registrarCaptacao({
    origem: querKit ? 'kit' : 'site',
    nome: d.nome,
    telefone: d.telefone,
    municipioId: d.municipioId,
    endereco: querKit ? (d.endereco ?? null) : null,
    itens: querKit ? d.itens : null,
    candidatoId: candidato.id,
    textoAceite: textoDoAceite({
      nome_urna: candidato.nome_urna,
      cargo: candidato.cargo as CargoEleitoral,
      numero: candidato.numero,
    }),
    ip: ipDosCabecalhos(cabecalhos),
    userAgent: cabecalhos.get('user-agent'),
  });

  return r.ok ? { ok: true, nome: r.primeiroNome } : { ok: false, erro: r.erro };
}
