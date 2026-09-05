import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Titulo } from '@/components/ui';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Config, DiaBloqueado, SaudeChip, TetoDoChip } from '@/lib/tipos-banco';
import { FormularioConfig } from './formulario';
import { AparelhosLiberados, type AparelhoNaTela } from './aparelhos';

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
  const [{ data: config }, { data: dias }, { data: chips }, { data: tetos },
         { data: aparelhos }, { data: equipe }] = await Promise.all([
    supabase.from('config').select('*').eq('id', 1).single(),
    supabase.from('dias_bloqueados').select('*').order('data'),
    supabase.from('v_saude_chip').select('*').order('rotulo'),
    supabase.rpc('teto_dos_chips'),
    supabase.from('aparelhos')
      .select('id, rotulo, usuario_id, liberado_em, expira_em, ultimo_uso_em, revogado_em')
      .is('revogado_em', null).order('criado_em', { ascending: false }),
    supabase.from('usuarios').select('id, primeiro_nome').eq('ativo', true).order('primeiro_nome'),
  ]);

  // O endereço por onde o gestor chegou: é ele que entra no link do convite, e
  // é o único que sabidamente funciona para quem vai abrir.
  const origem = `https://${(await headers()).get('host') ?? ''}`;

  return (
    <>
      <Titulo sub="Vale para todo mundo. Mudanças passam a valer na próxima vez que o atendente pedir um contato.">Configuração</Titulo>
      <FormularioConfig config={config as Config} dias={(dias ?? []) as DiaBloqueado[]}
                        chips={(chips ?? []) as SaudeChip[]}
                        tetos={(tetos ?? []) as TetoDoChip[]}
                        entrada={entrada} />
      <div className="mt-6">
        <AparelhosLiberados
          ligada={(config as Config).exigir_aparelho}
          aparelhos={(aparelhos ?? []) as AparelhoNaTela[]}
          equipe={(equipe ?? []) as { id: string; primeiro_nome: string }[]}
          origem={origem}
        />
      </div>
    </>
  );
}
