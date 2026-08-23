'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { ipDosCabecalhos, registrarCaptacao } from '@/lib/captacao';

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

  const cabecalhos = await headers();
  const r = await registrarCaptacao({
    origem: 'kit',
    nome: analise.data.nome,
    telefone: analise.data.telefone,
    municipioId: analise.data.municipioId,
    endereco: analise.data.endereco ?? null,
    itens: analise.data.itens,
    ip: ipDosCabecalhos(cabecalhos),
    userAgent: cabecalhos.get('user-agent'),
  });

  return r.ok ? { ok: true, nome: r.primeiroNome } : { ok: false, erro: r.erro };
}
