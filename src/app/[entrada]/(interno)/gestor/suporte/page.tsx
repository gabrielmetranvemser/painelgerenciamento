import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestor } from '@/lib/sessao';
import { Metrica, Titulo } from '@/components/ui';
import { Gavel, LifeBuoy, MessageSquareWarning, Siren } from 'lucide-react';
import type { Alerta, ChamadoNaLista } from '@/lib/tipos-banco';
import { listarChamados } from '@/app/[entrada]/(interno)/suporte/acoes';
import { PainelSuporte } from './painel';

export const metadata: Metadata = { title: 'Suporte' };
export const dynamic = 'force-dynamic';

/**
 * O painel de problemas e riscos.
 *
 * Junta as duas coisas que hoje chegavam ao gestor por fora: o que o atendente
 * escreve (chamados) e o que o sistema detecta (alertas do botão "WhatsApp
 * estranho" e de chip caído). Separadas, uma sempre ficava sem ninguém olhando.
 */
export default async function PaginaSuporteGestor({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  await exigirGestor(entrada);
  const supabase = await criarClienteServidor();

  const [chamados, { data: alertas }] = await Promise.all([
    listarChamados(),
    supabase.from('alertas').select('*').is('resolvido_em', null)
      .order('criado_em', { ascending: false }).limit(40),
  ]);

  const lista = chamados as ChamadoNaLista[];
  const emAberto = lista.filter((c) => c.status !== 'resolvido');
  const juridicos = emAberto.filter((c) => c.motivo === 'juridico');
  const esperando = emAberto.filter((c) => c.espera_gestor);

  return (
    <>
      <Titulo sub="O que os atendentes relataram e o que o sistema detectou, num lugar só.">
        Suporte
      </Titulo>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica rotulo="Risco jurídico" valor={juridicos.length}
                 tom={juridicos.length > 0 ? 'perigo' : undefined}
                 icone={<Gavel size={14} />}
                 detalhe={juridicos.length > 0 ? 'olhe estes primeiro' : undefined} />
        <Metrica rotulo="Esperando você" valor={esperando.length}
                 tom={esperando.length > 0 ? 'alerta' : undefined}
                 icone={<MessageSquareWarning size={14} />} />
        <Metrica rotulo="Chamados em aberto" valor={emAberto.length} icone={<LifeBuoy size={14} />} />
        <Metrica rotulo="Alertas do sistema" valor={(alertas ?? []).length} icone={<Siren size={14} />} />
      </div>

      <PainelSuporte
        entrada={entrada}
        chamados={lista}
        alertas={(alertas ?? []) as Alerta[]}
      />
    </>
  );
}
