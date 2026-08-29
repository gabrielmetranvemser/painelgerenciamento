import type { Metadata } from 'next';
import { Titulo } from '@/components/ui';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Config, DiaBloqueado, SaudeChip, TetoDoChip } from '@/lib/tipos-banco';
import { FormularioConfig } from './formulario';

export const metadata: Metadata = { title: 'Configuração' };
export const dynamic = 'force-dynamic';

export default async function PaginaConfig({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const supabase = await criarClienteServidor();

  // O teto que cada número tem HOJE vem junto de propósito: "Conversas por dia"
  // é o campo que o gestor mexeu três dias seguidos achando que não salvava, e
  // o que faltava na tela era justamente a resposta — qual número está seguindo
  // este número e qual ainda está na rampa de aquecimento.
  const [{ data: config }, { data: dias }, { data: chips }, { data: tetos }] = await Promise.all([
    supabase.from('config').select('*').eq('id', 1).single(),
    supabase.from('dias_bloqueados').select('*').order('data'),
    supabase.from('v_saude_chip').select('*').order('rotulo'),
    supabase.rpc('teto_dos_chips'),
  ]);

  return (
    <>
      <Titulo sub="Vale para todo mundo. Mudanças passam a valer na próxima vez que o atendente pedir um contato.">Configuração</Titulo>
      <FormularioConfig config={config as Config} dias={(dias ?? []) as DiaBloqueado[]}
                        chips={(chips ?? []) as SaudeChip[]}
                        tetos={(tetos ?? []) as TetoDoChip[]}
                        entrada={entrada} />
    </>
  );
}
