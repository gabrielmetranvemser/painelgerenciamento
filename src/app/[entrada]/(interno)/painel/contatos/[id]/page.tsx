import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import type { Chip, Contato, Municipio } from '@/lib/tipos-banco';
import { Perfil } from './perfil';

export const metadata: Metadata = { title: 'Contato' };
export const dynamic = 'force-dynamic';

export default async function PaginaContato({
  params,
}: {
  params: Promise<{ id: string; entrada: string }>;
}) {
  const { id, entrada } = await params;
  const usuario = await exigirAtendente(entrada);
  const supabase = await criarClienteServidor();

  // O RLS já limita a leitura aos próprios contatos: se não for dele, vem vazio.
  const [{ data: contato }, { data: chips }, { data: municipios }] = await Promise.all([
    supabase.from('contatos').select('*').eq('id', id).maybeSingle(),
    supabase.from('chips').select('*').eq('atendente_id', usuario.id).not('status', 'in', '("morto")'),
    supabase.from('municipios').select('*').order('nome'),
  ]);

  if (!contato) notFound();

  return (
    <Perfil
      contato={contato as Contato}
      chips={(chips ?? []) as Chip[]}
      municipios={(municipios ?? []) as Municipio[]}
      atendente={usuario.primeiro_nome}
      entrada={entrada}
    />
  );
}
