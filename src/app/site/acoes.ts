'use server';

import { headers } from 'next/headers';
import { z } from 'zod';
import { ipDosCabecalhos, registrarCaptacao } from '@/lib/captacao';

const Entrada = z.object({
  nome: z.string().trim().min(3, 'Escreva seu nome.').max(120),
  telefone: z.string().trim().min(8, 'Escreva seu WhatsApp com DDD.'),
  municipioId: z.coerce.number().int().positive('Escolha sua cidade.'),
  aceite: z.literal('on', { message: 'É preciso autorizar o contato pelo WhatsApp.' }),
});

export type ResultadoSite = { ok: true; nome: string } | { ok: false; erro: string };

export async function cadastrar(_anterior: ResultadoSite | null, form: FormData): Promise<ResultadoSite> {
  const analise = Entrada.safeParse({
    nome: form.get('nome'),
    telefone: form.get('telefone'),
    municipioId: form.get('municipio_id'),
    aceite: form.get('aceite'),
  });

  if (!analise.success) {
    return { ok: false, erro: analise.error.issues[0]?.message ?? 'Confira os campos.' };
  }

  const cabecalhos = await headers();
  const r = await registrarCaptacao({
    origem: 'site',
    nome: analise.data.nome,
    telefone: analise.data.telefone,
    municipioId: analise.data.municipioId,
    ip: ipDosCabecalhos(cabecalhos),
    userAgent: cabecalhos.get('user-agent'),
  });

  return r.ok ? { ok: true, nome: r.primeiroNome } : { ok: false, erro: r.erro };
}
