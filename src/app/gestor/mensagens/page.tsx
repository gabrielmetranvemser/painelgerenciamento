import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { Aviso } from '@/components/ui';
import type { Config, EtapaMsg, Modelo, Variacao } from '@/lib/tipos-banco';
import { EditorMensagens } from './editor';

export const metadata: Metadata = { title: 'Mensagens' };
export const dynamic = 'force-dynamic';

const ORDEM: EtapaMsg[] = [
  'permissao', 'material', 'saida', 'quem_passou',
  'quer_ajudar', 'encaminhamento', 'convite_grupo',
];

export default async function PaginaMensagens() {
  const supabase = await criarClienteServidor();

  const [{ data: modelos }, { data: variacoes }, { data: cfg }] = await Promise.all([
    supabase.from('modelos').select('*'),
    supabase.from('variacoes').select('*').order('ordem'),
    supabase.from('config').select('candidato, cargo, numero, timezone').eq('id', 1).single(),
  ]);

  const agrupados = (modelos ?? [])
    .map((m) => ({
      ...(m as Modelo),
      variacoes: ((variacoes ?? []) as Variacao[]).filter((v) => v.modelo_id === m.id),
    }))
    .sort((a, b) => ORDEM.indexOf(a.etapa) - ORDEM.indexOf(b.etapa));

  const c = cfg as Pick<Config, 'candidato' | 'cargo' | 'numero' | 'timezone'> | null;

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Mensagens</h1>
      <p className="mb-5 text-sm text-suave">
        Você edita os textos sem depender do desenvolvedor. Algumas partes são obrigatórias e o
        sistema não deixa salvar sem elas.
      </p>

      {!c?.candidato && (
        <Aviso tom="alerta" className="mb-5">
          Defina o nome do candidato, o cargo e o número em <strong>Configuração</strong> — sem
          isso a prévia e as mensagens saem com lacunas.
        </Aviso>
      )}

      <EditorMensagens
        modelos={agrupados}
        exemplo={{
          candidato: c?.candidato ?? '',
          cargo: c?.cargo ?? '',
          numero: c?.numero ?? '',
          timezone: c?.timezone ?? 'America/Porto_Velho',
        }}
      />
    </>
  );
}
