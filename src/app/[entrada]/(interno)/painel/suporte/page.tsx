import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirAtendente } from '@/lib/sessao';
import { Titulo } from '@/components/ui';
import type { Chip, ChamadoNaLista } from '@/lib/tipos-banco';
import { listarChamados } from '@/app/[entrada]/(interno)/suporte/acoes';
import { Suporte } from './suporte';

export const metadata: Metadata = { title: 'Falar com o gestor' };
export const dynamic = 'force-dynamic';

export default async function PaginaSuporte({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  await exigirAtendente(entrada);
  const supabase = await criarClienteServidor();

  // Só os contatos que estão com esta pessoa — é sobre eles que ela tem o que
  // relatar, e o RLS já não deixaria escolher outro.
  const [chamados, { data: contatos }, { data: chips }] = await Promise.all([
    listarChamados(),
    supabase
      .from('contatos')
      .select('id, nome, telefone_e164, status')
      .not('telefone_e164', 'is', null)
      .order('primeiro_contato_em', { ascending: false, nullsFirst: false })
      .limit(300),
    supabase.from('chips').select('*').order('rotulo'),
  ]);

  return (
    <>
      <Titulo sub="Dúvida, problema técnico ou algo que te preocupou numa conversa. O gestor vê aqui, com o print junto.">
        Falar com o gestor
      </Titulo>

      <Suporte
        entrada={entrada}
        chamados={chamados as ChamadoNaLista[]}
        contatos={(contatos ?? []) as { id: string; nome: string | null; telefone_e164: string }[]}
        chips={(chips ?? []) as Chip[]}
      />
    </>
  );
}
