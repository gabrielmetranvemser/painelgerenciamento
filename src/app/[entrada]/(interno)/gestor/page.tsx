import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowUpRight, BellRing, Flame, Gavel, LifeBuoy, MousePointerClick, Smartphone, Snowflake,
  ThumbsUp, TriangleAlert, UsersRound, UserX,
} from 'lucide-react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { Avatar, Cartao, Farol, Metrica, Titulo, Vazio } from '@/components/ui';
import { rotas } from '@/lib/links-internos';
import type { Alerta, DesempenhoAtendente, Resumo, SaudeChip } from '@/lib/tipos-banco';

export const metadata: Metadata = { title: 'Visão geral' };
export const dynamic = 'force-dynamic';

export default async function PainelGestor({ params }: { params: Promise<{ entrada: string }> }) {
  const { entrada } = await params;
  const rt = rotas(entrada);
  const supabase = await criarClienteServidor();

  const [{ data: resumo }, { data: chips }, { data: atendentes }, { data: alertas }] =
    await Promise.all([
      supabase.from('v_resumo').select('*').single(),
      supabase.from('v_saude_chip').select('*').order('rotulo'),
      supabase.from('v_desempenho_atendente').select('*').order('hoje', { ascending: false }),
      supabase.from('alertas').select('*').is('resolvido_em', null)
        .order('criado_em', { ascending: false }).limit(8),
    ]);

  const r = resumo as Resumo | null;
  const listaChips = (chips ?? []) as SaudeChip[];
  const vermelhos = listaChips.filter((c) => c.farol === 'vermelho');

  return (
    <>
      <Titulo sub="Como a operação está agora. Os números atualizam a cada carga da página.">
        Visão geral
      </Titulo>

      {(r?.juridicos_abertos ?? 0) > 0 && (
        <Link href={rt.gestorSuporte} className="mb-6 block">
          <Cartao className="border-perigo/40 bg-perigo/[0.08] p-5 transition-colors hover:border-perigo/60">
            <div className="flex gap-3">
              <Gavel size={18} className="mt-0.5 shrink-0 text-perigo" />
              <div>
                <p className="font-semibold text-perigo">
                  {r!.juridicos_abertos === 1
                    ? 'Um atendente relatou risco jurídico'
                    : `${r!.juridicos_abertos} relatos de risco jurídico em aberto`}
                </p>
                <p className="mt-1 text-sm leading-relaxed text-suave">
                  Intimação, ameaça de denúncia ou advogado. Abra antes de qualquer outra coisa —
                  quem relatou está parado esperando resposta.
                </p>
              </div>
              <ArrowUpRight size={16} className="ml-auto shrink-0 text-perigo" />
            </div>
          </Cartao>
        </Link>
      )}

      {vermelhos.length > 0 && (
        <Cartao className="mb-6 border-perigo/30 bg-perigo/[0.06] p-5">
          <div className="flex gap-3">
            <TriangleAlert size={18} className="mt-0.5 shrink-0 text-perigo" />
            <div>
              <p className="font-semibold text-perigo">
                {vermelhos.length === 1 ? 'Um número precisa' : `${vermelhos.length} números precisam`} sair de circulação
              </p>
              <p className="mt-1 text-sm leading-relaxed text-suave">
                {vermelhos.map((c) => `${c.rotulo} (${c.atendente ?? 'sem dono'})`).join(', ')} — pause
                24 a 48h e troque pelo reserva antes que o WhatsApp derrube.
              </p>
            </div>
          </div>
        </Cartao>
      )}

      <Secao titulo="Fila">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metrica rotulo="Fila quente" valor={r?.fila_quente ?? 0} tom="quente"
                   icone={<Flame size={14} />} detalhe="Pediram contato. Atender primeiro." />
          <Metrica rotulo="Fila fria" valor={r?.fila_fria ?? 0} tom="frio" icone={<Snowflake size={14} />} />
          <Metrica rotulo="Em atendimento" valor={r?.em_atendimento ?? 0} />
          <Metrica rotulo="Abordados hoje" valor={r?.abordados_hoje ?? 0} />
        </div>
      </Secao>

      <Secao titulo="Resultado">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <Metrica rotulo="Cliques no link" valor={r?.cliques_reais ?? 0} tom="acento"
                   icone={<MousePointerClick size={14} />} detalhe="A métrica mais confiável." />
          <Metrica rotulo="Autorizaram" valor={r?.autorizou ?? 0} icone={<ThumbsUp size={14} />} />
          <Metrica rotulo="Pediram saída" valor={r?.pediu_saida ?? 0} tom="alerta" icone={<UserX size={14} />} />
          <Metrica rotulo="Sem resposta" valor={r?.sem_resposta ?? 0} />
          <Metrica rotulo="Perdidos" valor={r?.perdidos ?? 0} detalhe="O número caiu junto." />
        </div>
        <p className="mt-3 max-w-3xl text-xs leading-relaxed text-suave">
          O clique é o único dado que o sistema controla de verdade: a conversa acontece no WhatsApp
          do atendente e some se o número cair. O pré-carregamento do WhatsApp não entra na conta.
        </p>
      </Secao>

      <div className="grid gap-6 lg:grid-cols-2">
        <Secao titulo="Saúde dos números" link={{ href: rt.gestorChips, rotulo: 'gerenciar' }}>
          {listaChips.length === 0 ? (
            <Vazio icone={<Smartphone size={26} />}>Nenhum número cadastrado ainda.</Vazio>
          ) : (
            <Cartao className="divide-y divide-borda overflow-hidden">
              {listaChips.map((c) => (
                <div key={c.chip_id} className="flex flex-wrap items-center gap-3 px-5 py-4">
                  <Avatar nome={c.atendente} tamanho="p" />
                  <div className="mr-auto min-w-0">
                    <p className="truncate text-sm font-semibold">{c.rotulo}</p>
                    <p className="truncate text-xs text-suave">
                      {c.atendente ?? 'sem dono'}
                      {c.ultimas_abordagens > 0 && ` · ${c.ultimas_abordagens} abordagens recentes`}
                    </p>
                  </div>
                  {c.pct_saida !== null && (
                    <span className="tabular text-xs text-suave">{c.pct_saida}% saída</span>
                  )}
                  <Farol estado={c.farol} />
                </div>
              ))}
            </Cartao>
          )}
        </Secao>

        <Secao titulo="Atendentes hoje" link={{ href: rt.gestorAtendentes, rotulo: 'gerenciar' }}>
          {(atendentes ?? []).length === 0 ? (
            <Vazio icone={<UsersRound size={26} />}>
              Nenhum atendente cadastrado. Crie as contas para a fila começar a andar.
            </Vazio>
          ) : (
            <Cartao className="divide-y divide-borda overflow-hidden">
              {((atendentes ?? []) as DesempenhoAtendente[]).map((a) => (
                <div key={a.atendente_id} className="flex items-center gap-3 px-5 py-4">
                  <Avatar nome={a.atendente} tamanho="p" />
                  <p className="mr-auto min-w-0 truncate text-sm font-semibold">
                    {a.atendente}
                    {!a.ativo && <span className="ml-2 text-xs font-normal text-tenue">(inativo)</span>}
                  </p>
                  <span className="tabular text-sm font-semibold">{a.hoje}</span>
                  <span className="text-xs text-suave">hoje</span>
                  <span className="tabular ml-3 text-sm font-semibold text-acento">{a.cliques_reais}</span>
                  <span className="text-xs text-suave">cliques</span>
                </div>
              ))}
            </Cartao>
          )}
        </Secao>
      </div>

      {((alertas ?? []).length > 0 || (r?.chamados_abertos ?? 0) > 0) && (
        <Secao titulo="Avisos" className="mt-6"
               link={{ href: rt.gestorSuporte, rotulo: 'abrir suporte' }}>
          {(r?.chamados_abertos ?? 0) > 0 && (
            <Link href={rt.gestorSuporte}
                  className="mb-3 flex items-center gap-3 rounded-2xl border border-borda bg-superficie px-5 py-4 transition-colors hover:border-borda-forte">
              <LifeBuoy size={16} className="shrink-0 text-suave" />
              <p className="mr-auto text-sm">
                <strong>{r!.chamados_abertos}</strong>{' '}
                {r!.chamados_abertos === 1 ? 'chamado aberto' : 'chamados abertos'} de atendente
              </p>
              <ArrowUpRight size={15} className="shrink-0 text-suave" />
            </Link>
          )}
          <Cartao className="divide-y divide-borda overflow-hidden">
            {((alertas ?? []) as Alerta[]).map((a) => (
              <div key={a.id} className="flex gap-3 px-5 py-4">
                <BellRing size={16} className="mt-0.5 shrink-0 text-alerta" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{rotuloAlerta(a.tipo)}</p>
                  <p className="mt-0.5 text-xs leading-relaxed text-suave">
                    {a.detalhe && `${a.detalhe} · `}
                    {new Date(a.criado_em).toLocaleString('pt-BR')}
                  </p>
                </div>
              </div>
            ))}
          </Cartao>
        </Secao>
      )}
    </>
  );
}

function Secao({
  titulo, link, children, className,
}: {
  titulo: string;
  link?: { href: string; rotulo: string };
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <section className={`mb-7 ${className ?? ''}`}>
      <div className="mb-3 flex items-baseline gap-3">
        <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-suave">{titulo}</h2>
        {link && (
          <Link
            href={link.href}
            className="ml-auto inline-flex items-center gap-1 text-xs font-medium text-acento hover:underline"
          >
            {link.rotulo} <ArrowUpRight size={13} />
          </Link>
        )}
      </div>
      {children}
    </section>
  );
}

function rotuloAlerta(tipo: string) {
  return {
    whatsapp_estranho: 'Um atendente avisou que o WhatsApp está estranho',
    chip_morto: 'Número marcado como morto',
    bloqueio_removido_por_optin: 'Bloqueio removido: a pessoa se cadastrou de novo, com aceite',
    saida_corrigida: 'Um "Pediu saída" foi corrigido e o bloqueio removido',
  }[tipo] ?? tipo;
}
