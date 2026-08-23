import type { Metadata } from 'next';
import Link from 'next/link';
import { criarClienteServidor } from '@/lib/supabase/server';
import { Cartao, Farol, Metrica, Vazio } from '@/components/ui';
import type { Alerta, DesempenhoAtendente, Resumo, SaudeChip } from '@/lib/tipos-banco';

export const metadata: Metadata = { title: 'Visão geral' };
export const dynamic = 'force-dynamic';

export default async function PainelGestor() {
  const supabase = await criarClienteServidor();

  const [{ data: resumo }, { data: chips }, { data: atendentes }, { data: alertas }] =
    await Promise.all([
      supabase.from('v_resumo').select('*').single(),
      supabase.from('v_saude_chip').select('*').order('rotulo'),
      supabase.from('v_desempenho_atendente').select('*').order('hoje', { ascending: false }),
      supabase.from('alertas').select('*').is('resolvido_em', null).order('criado_em', { ascending: false }).limit(10),
    ]);

  const r = resumo as Resumo | null;
  const listaChips = (chips ?? []) as SaudeChip[];
  const vermelhos = listaChips.filter((c) => c.farol === 'vermelho');

  return (
    <>
      <h1 className="mb-5 text-xl font-semibold">Visão geral</h1>

      {vermelhos.length > 0 && (
        <Cartao className="mb-5 border-perigo/40 bg-perigo/5 p-4">
          <p className="text-sm font-medium text-perigo">
            {vermelhos.length === 1 ? 'Um número precisa' : `${vermelhos.length} números precisam`} sair de circulação
          </p>
          <p className="mt-1 text-xs text-suave">
            {vermelhos.map((c) => `${c.rotulo} (${c.atendente ?? 'sem dono'})`).join(', ')} —
            pause 24 a 48h e troque pelo reserva antes que o WhatsApp derrube.
          </p>
        </Cartao>
      )}

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-suave">Fila</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Metrica rotulo="Fila quente" valor={r?.fila_quente ?? 0} tom="text-quente"
                   detalhe="pediram contato — atender primeiro" />
          <Metrica rotulo="Fila fria" valor={r?.fila_fria ?? 0} tom="text-frio" />
          <Metrica rotulo="Em atendimento" valor={r?.em_atendimento ?? 0} />
          <Metrica rotulo="Abordados hoje" valor={r?.abordados_hoje ?? 0} />
        </div>
      </section>

      <section className="mb-6">
        <h2 className="mb-2 text-sm font-medium text-suave">Resultado</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metrica rotulo="Cliques no link" valor={r?.cliques_reais ?? 0} tom="text-ok"
                   detalhe="a métrica mais confiável" />
          <Metrica rotulo="Autorizaram" valor={r?.autorizou ?? 0} />
          <Metrica rotulo="Pediram saída" valor={r?.pediu_saida ?? 0} tom="text-alerta" />
          <Metrica rotulo="Sem resposta" valor={r?.sem_resposta ?? 0} />
          <Metrica rotulo="Perdidos" valor={r?.perdidos ?? 0} detalhe="chip caiu junto" />
        </div>
        <p className="mt-2 text-xs text-suave">
          O clique é o único dado que o sistema controla de verdade: a conversa acontece no
          WhatsApp do atendente e some se o número cair. Pré-carregamento do WhatsApp não conta.
        </p>
      </section>

      <div className="grid gap-6 lg:grid-cols-2">
        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-suave">Saúde dos números</h2>
            <Link href="/gestor/chips" className="text-xs text-acento hover:underline">gerenciar</Link>
          </div>
          {listaChips.length === 0 ? (
            <Vazio>Nenhum número cadastrado.</Vazio>
          ) : (
            <Cartao className="divide-y divide-borda">
              {listaChips.map((c) => (
                <div key={c.chip_id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="mr-auto">
                    <p className="text-sm font-medium">{c.rotulo}</p>
                    <p className="text-xs text-suave">
                      {c.atendente ?? 'sem dono'}
                      {c.ultimas_abordagens > 0 && ` · ${c.ultimas_abordagens} abordagens recentes`}
                    </p>
                  </div>
                  {c.pct_saida !== null && (
                    <span className="text-xs text-suave">{c.pct_saida}% saída</span>
                  )}
                  <Farol estado={c.farol} />
                </div>
              ))}
            </Cartao>
          )}
        </section>

        <section>
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-medium text-suave">Atendentes hoje</h2>
            <Link href="/gestor/atendentes" className="text-xs text-acento hover:underline">gerenciar</Link>
          </div>
          {(atendentes ?? []).length === 0 ? (
            <Vazio>Nenhum atendente cadastrado.</Vazio>
          ) : (
            <Cartao className="divide-y divide-borda">
              {((atendentes ?? []) as DesempenhoAtendente[]).map((a) => (
                <div key={a.atendente_id} className="flex items-center gap-3 px-4 py-3">
                  <p className="mr-auto text-sm font-medium">
                    {a.atendente}
                    {!a.ativo && <span className="ml-2 text-xs text-suave">(inativo)</span>}
                  </p>
                  <span className="text-sm tabular-nums">{a.hoje} hoje</span>
                  <span className="text-xs text-suave">{a.autorizou} autorizaram</span>
                  <span className="text-xs text-ok">{a.cliques_reais} cliques</span>
                </div>
              ))}
            </Cartao>
          )}
        </section>
      </div>

      {(alertas ?? []).length > 0 && (
        <section className="mt-6">
          <h2 className="mb-2 text-sm font-medium text-suave">Avisos</h2>
          <Cartao className="divide-y divide-borda">
            {((alertas ?? []) as Alerta[]).map((a) => (
              <div key={a.id} className="px-4 py-3">
                <p className="text-sm font-medium">{rotuloAlerta(a.tipo)}</p>
                <p className="text-xs text-suave">
                  {a.detalhe} · {new Date(a.criado_em).toLocaleString('pt-BR')}
                </p>
              </div>
            ))}
          </Cartao>
        </section>
      )}
    </>
  );
}

function rotuloAlerta(tipo: string) {
  return {
    whatsapp_estranho: 'Um atendente avisou que o WhatsApp está estranho',
    chip_morto: 'Número marcado como morto',
    bloqueio_removido_por_optin: 'Bloqueio removido: pessoa pediu kit com aceite explícito',
  }[tipo] ?? tipo;
}
