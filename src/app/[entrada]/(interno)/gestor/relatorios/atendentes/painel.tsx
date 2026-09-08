import Link from 'next/link';
import {
  CalendarDays, Clock, Contact, Flame, MessageSquare, MousePointerClick,
  ThumbsUp, TrendingUp, Users,
} from 'lucide-react';
import { Avatar, BotaoLink, Cartao, Metrica, Pilula, Titulo, Vazio, cx } from '@/components/ui';
import {
  BarraDeGrupos, BarrasComparativas, BarrasPorDia, BarrasPorHora, FaixasDeJornada, Grafico, Legenda,
} from '@/components/graficos';
import { rotas } from '@/lib/links-internos';
import { ROTULO_ETAPA, type EtapaMsg } from '@/lib/tipos-banco';
import {
  GRUPOS_DE_DESFECHO, PERIODOS, corDoStatus, diaCurto, diaPorExtenso, duracao, numero,
  porDiaTrabalhado, quemTrabalhou, relogio, rotuloDoStatus, somar, taxa,
  type LinhaDaEquipe, type RelatorioDeAtendimento,
} from '@/lib/desempenho';

type Busca = { dias?: string; atendente?: string };

/**
 * O desenho da tela de Desempenho — sem nenhuma ida ao banco.
 *
 * ⚠️ Recebe TUDO por prop, de propósito. É o que permite montar a tela com
 * dados de verdade fora de uma requisição e olhar para ela antes de subir; uma
 * tela deste tamanho que só existe atrás do login é uma tela que ninguém
 * confere. Ver o comentário de `page.tsx`.
 *
 * ⚠️ Sem `'use client'`: os gráficos são SVG desenhado no servidor e nada aqui
 * tem estado. O recorte — período e pessoa — vive na URL.
 */
export function PainelDeDesempenho({
  relatorio, config, dias, escolhido, rt,
}: {
  relatorio: RelatorioDeAtendimento;
  config: { hora_inicio: number; hora_fim: number } | null;
  dias: number;
  escolhido: string;
  rt: ReturnType<typeof rotas>;
}) {
  const equipe = relatorio.equipe;
  const pessoa = escolhido ? equipe.find((a) => a.atendente_id === escolhido) : undefined;

  // "Todos" soma a equipe; um atendente escolhido é a linha dele. As séries
  // (dia, hora, jornada) já vêm recortadas do banco nos dois casos.
  const total = {
    pessoas: pessoa ? pessoa.pessoas : somar(equipe, 'pessoas'),
    aberturas: pessoa ? pessoa.aberturas : somar(equipe, 'aberturas'),
    positivos: pessoa ? pessoa.positivos : somar(equipe, 'positivos'),
    autorizou: pessoa ? pessoa.autorizou : somar(equipe, 'autorizou'),
    negativos: pessoa ? pessoa.negativos : somar(equipe, 'negativos'),
    sem_resposta: pessoa ? pessoa.sem_resposta : somar(equipe, 'sem_resposta'),
    em_aberto: pessoa ? pessoa.em_aberto : somar(equipe, 'em_aberto'),
    cliques: pessoa ? pessoa.cliques : somar(equipe, 'cliques'),
  };

  const grupos = GRUPOS_DE_DESFECHO.map((g) => ({
    chave: g.chave,
    rotulo: g.rotulo,
    cor: g.cor,
    dica: g.dica,
    valor: total[g.chave],
  }));

  const trabalharam = quemTrabalhou(equipe);
  const link = (proximo: Busca) => {
    const p = new URLSearchParams();
    const d = proximo.dias ?? String(dias);
    const a = proximo.atendente ?? escolhido;
    if (d !== '30') p.set('dias', d);
    if (a) p.set('atendente', a);
    const s = p.toString();
    return `${rt.gestorDesempenho}${s ? `?${s}` : ''}`;
  };

  return (
    <>
      <Titulo
        sub={
          <>
            O período escolhe as <strong className="text-texto">pessoas</strong>: quem cada
            atendente abordou naqueles dias. O desfecho de cada uma é a situação dela hoje —
            por isso os quatro grupos somam exatamente o total de abordados.
          </>
        }
        acao={
          <BotaoLink href={rt.gestorRelatorios} variante="neutro" tamanho="p">
            Voltar aos relatórios
          </BotaoLink>
        }
      >
        Desempenho por atendente
      </Titulo>

      {/* ── período ─────────────────────────────────────────────────────── */}
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav className="inline-flex rounded-full border border-borda bg-superficie p-1">
          {PERIODOS.map((p) => (
            <Link
              key={p.dias}
              href={link({ dias: String(p.dias) })}
              scroll={false}
              className={cx(
                'rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
                p.dias === dias
                  ? 'bg-acento text-tinta-acento'
                  : 'text-suave hover:text-texto',
              )}
            >
              {p.rotulo}
            </Link>
          ))}
        </nav>
        <p className="text-xs text-suave">
          {diaPorExtenso(relatorio.periodo.desde)} até {diaPorExtenso(relatorio.periodo.ate)}
        </p>
      </div>

      {/* ── quem ────────────────────────────────────────────────────────── */}
      <div className="-mx-1 mb-6 overflow-x-auto px-1 pb-1">
        <div className="flex w-max gap-2">
          <Link
            href={link({ atendente: '' })}
            scroll={false}
            className={cx(
              'flex items-center gap-2 rounded-full border px-3.5 py-1.5 text-xs font-semibold transition-colors',
              escolhido
                ? 'border-borda text-suave hover:border-borda-forte hover:text-texto'
                : 'border-acento/40 bg-acento/12 text-acento',
            )}
          >
            <Users size={13} /> A equipe toda
          </Link>
          {equipe.map((a) => (
            <Link
              key={a.atendente_id}
              href={link({ atendente: a.atendente_id })}
              scroll={false}
              className={cx(
                'flex items-center gap-2 rounded-full border py-1 pl-1 pr-3.5 text-xs font-semibold transition-colors',
                a.atendente_id === escolhido
                  ? 'border-acento/40 bg-acento/12 text-acento'
                  : 'border-borda text-suave hover:border-borda-forte hover:text-texto',
                // Quem não trabalhou no período continua clicável — o gestor
                // abre a página justamente para conferir quem sumiu.
                a.pessoas === 0 && a.atendente_id !== escolhido && 'opacity-55',
              )}
            >
              <Avatar nome={a.atendente} fotoUrl={a.foto_url} tamanho="p" />
              {a.atendente}
              {!a.ativo && <span className="font-normal text-tenue">inativo</span>}
            </Link>
          ))}
        </div>
      </div>

      {pessoa && <CabecalhoDaPessoa pessoa={pessoa} rt={rt} />}

      {/* ── os números do recorte ───────────────────────────────────────── */}
      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          rotulo="Pessoas abordadas" valor={total.pessoas} icone={<Contact size={14} />}
          detalhe={pessoa
            ? `${porDiaTrabalhado(pessoa).toFixed(1).replace('.', ',')} por dia trabalhado`
            : `${trabalharam.length} de ${equipe.length} atendentes trabalharam`}
        />
        <Metrica
          rotulo="Conversas abertas" valor={total.aberturas} icone={<MessageSquare size={14} />}
          detalhe={`Vezes que clicou em "Abrir conversa". A mesma pessoa rende várias — ${
            total.pessoas > 0 ? (total.aberturas / total.pessoas).toFixed(1).replace('.', ',') : '0'
          } por pessoa.`}
        />
        <Metrica
          rotulo="Autorizações" valor={total.autorizou} tom="acento" icone={<ThumbsUp size={14} />}
          detalhe={`${taxa(total.autorizou, total.pessoas)} de quem foi abordado no período.`}
        />
        <Metrica
          rotulo="Abriram o material" valor={total.cliques} tom="frio"
          icone={<MousePointerClick size={14} />}
          detalhe="Cliques de gente de verdade — a prévia do WhatsApp não conta."
        />
      </section>

      {/* ── o que deu e o que não deu ───────────────────────────────────── */}
      <Cartao className="mb-6 p-5">
        <div className="mb-3 flex flex-wrap items-baseline gap-3">
          <h3 className="mr-auto text-sm font-semibold">No que deu</h3>
          <p className="text-xs text-suave">
            {numero(total.pessoas)} pessoa{total.pessoas === 1 ? '' : 's'} abordada
            {total.pessoas === 1 ? '' : 's'} no período
          </p>
        </div>
        <BarraDeGrupos partes={grupos} />
        <div className="mt-3">
          <Legenda itens={grupos.map((g) => ({ ...g, valor: g.valor }))} />
        </div>
      </Cartao>

      {/* ── ao longo dos dias ───────────────────────────────────────────── */}
      <Grafico
        className="mb-6"
        titulo="Dia a dia"
        dica="Pessoas distintas abordadas em cada dia. Dia parado aparece como coluna vazia — de propósito."
      >
        <BarrasPorDia
          dados={relatorio.dias.map((d) => ({
            rotulo: diaCurto(d.dia),
            titulo: `${diaPorExtenso(d.dia)} — ${d.pessoas} pessoa${d.pessoas === 1 ? '' : 's'}, `
              + `${d.aberturas} conversa${d.aberturas === 1 ? '' : 's'} aberta${d.aberturas === 1 ? '' : 's'}`,
            valor: d.pessoas,
          }))}
        />
      </Grafico>

      {pessoa ? (
        <Individual pessoa={pessoa} relatorio={relatorio} config={config} rt={rt} />
      ) : (
        <Comparacao equipe={equipe} relatorio={relatorio} config={config} link={link} />
      )}
    </>
  );
}


/* ── O cabeçalho de quem está sendo olhado ──────────────────────────────── */

function CabecalhoDaPessoa({
  pessoa, rt,
}: {
  pessoa: LinhaDaEquipe;
  rt: ReturnType<typeof rotas>;
}) {
  return (
    <Cartao className="mb-6 flex flex-wrap items-center gap-4 p-5">
      <Avatar nome={pessoa.atendente} fotoUrl={pessoa.foto_url} tamanho="g" />
      <div className="mr-auto min-w-0">
        <p className="font-display text-2xl font-semibold tracking-tight">{pessoa.atendente}</p>
        <p className="mt-0.5 text-xs text-suave">
          {pessoa.dias_trabalhados} dia{pessoa.dias_trabalhados === 1 ? '' : 's'} com conversa ·{' '}
          {pessoa.horas_ativas} hora{pessoa.horas_ativas === 1 ? '' : 's'} com atividade
        </p>
      </div>
      {!pessoa.ativo && <Pilula cor="perigo">inativo</Pilula>}
      <BotaoLink
        href={`${rt.gestorContatos}?atendente=${pessoa.atendente_id}`}
        variante="neutro" tamanho="p" prefetch={false}
      >
        Ver os contatos dele
      </BotaoLink>
    </Cartao>
  );
}

/* ── A tela de uma pessoa ───────────────────────────────────────────────── */

function Individual({
  pessoa, relatorio, config, rt,
}: {
  pessoa: LinhaDaEquipe;
  relatorio: RelatorioDeAtendimento;
  config: { hora_inicio: number; hora_fim: number } | null;
  rt: ReturnType<typeof rotas>;
}) {
  const maisCheio = Math.max(...relatorio.jornada.map((j) => j.pessoas), 1);
  const minutosNoAr = relatorio.jornada.reduce((s, j) => s + (j.fim - j.inicio), 0);
  const mediaDaJanela = relatorio.jornada.length > 0 ? minutosNoAr / relatorio.jornada.length : 0;

  return (
    <>
      <section className="mb-6 grid gap-6 lg:grid-cols-2">
        <Grafico
          titulo="A que horas ele fala"
          dica={
            <>
              Conversas abertas por hora do dia, somando o período.
              {config && (
                <> A janela da campanha é {config.hora_inicio}h–{config.hora_fim}h; o que
                  aparecer em âmbar caiu fora dela.</>
              )}
            </>
          }
        >
          <BarrasPorHora
            horas={relatorio.horas.map((h) => ({ hora: h.hora, valor: h.aberturas }))}
            janela={config ? { inicio: config.hora_inicio, fim: config.hora_fim } : undefined}
          />
        </Grafico>

        <Grafico
          titulo="No que as conversas dele deram"
          dica="Cada pessoa abordada no período, na situação em que está hoje."
        >
          {relatorio.desfechos.length === 0 ? (
            <p className="text-xs text-suave">Nenhuma conversa no período.</p>
          ) : (
            <ul className="space-y-2">
              {relatorio.desfechos.map((d) => (
                <li key={d.resultado} className="flex items-center gap-3">
                  <span className="size-2 shrink-0 rounded-full"
                        style={{ background: corDoStatus(d.resultado) }} />
                  <span className="mr-auto truncate text-[13px]">{rotuloDoStatus(d.resultado)}</span>
                  <span className="text-xs text-suave">{taxa(d.pessoas, pessoa.pessoas)}</span>
                  <span className="w-12 text-right font-display text-sm font-semibold tabular">
                    {numero(d.pessoas)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Grafico>
      </section>

      <Grafico
        className="mb-6"
        titulo="Da primeira à última conversa, por dia"
        dica={
          <>
            <strong className="text-texto">Isto não é folha de ponto.</strong> O painel não sabe
            quando alguém sentou nem quando levantou — sabe quando abriu conversa. Quem passou a
            manhã organizando a base e só começou a falar às 14h aparece aqui como quem chegou às
            14h.
            {relatorio.jornada.length > 0 && (
              <> Em média, {duracao(mediaDaJanela)} entre a primeira e a última de cada dia.</>
            )}
          </>
        }
      >
        <FaixasDeJornada
          dias={relatorio.jornada.map((j) => ({
            rotulo: diaCurto(j.dia),
            titulo: `${diaPorExtenso(j.dia)} — das ${relogio(j.inicio)} às ${relogio(j.fim)} · `
              + `${j.pessoas} pessoa${j.pessoas === 1 ? '' : 's'} · ${j.horas_ativas}h com atividade`,
            inicio: j.inicio,
            fim: j.fim,
            intensidade: j.pessoas / maisCheio,
          }))}
        />
      </Grafico>

      <section className="grid gap-6 lg:grid-cols-2">
        <Grafico
          titulo="Em que passo da conversa"
          dica="A conversa tem quatro passos. Ver muita abertura e pouco material quer dizer que ela morre no começo."
        >
          {relatorio.etapas.length === 0 ? (
            <p className="text-xs text-suave">Nenhuma conversa no período.</p>
          ) : (
            <BarrasComparativas
              itens={relatorio.etapas.map((e) => ({
                chave: e.etapa,
                rotulo: ROTULO_ETAPA[e.etapa as EtapaMsg] ?? e.etapa,
                valor: e.aberturas,
                detalhe: `${numero(e.pessoas)} pessoa${e.pessoas === 1 ? '' : 's'}`,
              }))}
            />
          )}
        </Grafico>

        <Grafico
          titulo="Na mão dele agora"
          dica="⚠️ Estes três são deste instante, não do período — inclusive de conversa que começou antes do recorte."
          acao={
            <BotaoLink
              href={`${rt.gestorContatos}?atendente=${pessoa.atendente_id}&recorte=pendentes`}
              variante="neutro" tamanho="p" prefetch={false}
            >
              Abrir
            </BotaoLink>
          }
        >
          <div className="grid gap-3 sm:grid-cols-3">
            <Numerinho rotulo="Reservados agora" valor={pessoa.na_mao_agora} />
            <Numerinho rotulo="Aguardando resposta" valor={pessoa.aguardando_resposta} tom="alerta" />
            <Numerinho
              rotulo="Pegou e não falou" valor={pessoa.abertos_sem_falar}
              tom={pessoa.abertos_sem_falar > 0 ? 'perigo' : undefined}
            />
          </div>
        </Grafico>
      </section>
    </>
  );
}

function Numerinho({
  rotulo, valor, tom,
}: {
  rotulo: string; valor: number; tom?: 'alerta' | 'perigo';
}) {
  // Mapa estático: o Tailwind só enxerga nome de classe literal.
  const cor = { alerta: 'text-alerta', perigo: 'text-perigo' } as const;
  return (
    <div className="rounded-2xl border border-borda bg-superficie-alta px-4 py-3">
      <p className={cx('font-display text-2xl font-semibold tabular', tom ? cor[tom] : 'text-texto')}>
        {numero(valor)}
      </p>
      <p className="mt-0.5 text-[11px] leading-snug text-suave">{rotulo}</p>
    </div>
  );
}

/* ── A tela da equipe ───────────────────────────────────────────────────── */

function Comparacao({
  equipe, relatorio, config, link,
}: {
  equipe: LinhaDaEquipe[];
  relatorio: RelatorioDeAtendimento;
  config: { hora_inicio: number; hora_fim: number } | null;
  link: (b: Busca) => string;
}) {
  const trabalharam = quemTrabalhou(equipe);
  const parados = equipe.filter((a) => a.pessoas === 0 && a.ativo);

  return (
    <>
      <section className="mb-6 grid gap-6 lg:grid-cols-2">
        <Grafico
          titulo="Quem falou com mais gente"
          dica="Cada barra é dividida pelo que aconteceu com aquelas pessoas. Barra grande e cinza quer dizer volume sem desfecho."
          acao={<Legenda itens={GRUPOS_DE_DESFECHO.map((g) => ({ ...g, dica: g.dica }))} />}
        >
          <BarrasComparativas
            itens={trabalharam.map((a) => ({
              chave: a.atendente_id,
              rotulo: a.atendente,
              valor: a.pessoas,
              detalhe: `${a.dias_trabalhados}d · ${taxa(a.autorizou, a.pessoas)} autorizou`,
              partes: GRUPOS_DE_DESFECHO.map((g) => ({
                chave: g.chave, rotulo: g.rotulo, cor: g.cor, valor: a[g.chave],
              })),
            }))}
          />
          {parados.length > 0 && (
            <p className="mt-4 text-xs leading-relaxed text-suave">
              Sem nenhuma conversa no período:{' '}
              <strong className="text-texto">{parados.map((a) => a.atendente).join(', ')}</strong>.
            </p>
          )}
        </Grafico>

        <Grafico
          titulo="A que horas a equipe fala"
          dica={
            <>
              Conversas abertas por hora do dia, somando todo mundo.
              {config && (
                <> A janela da campanha é {config.hora_inicio}h–{config.hora_fim}h; o que
                  aparecer em âmbar caiu fora dela.</>
              )}
            </>
          }
        >
          <BarrasPorHora
            horas={relatorio.horas.map((h) => ({ hora: h.hora, valor: h.aberturas }))}
            janela={config ? { inicio: config.hora_inicio, fim: config.hora_fim } : undefined}
          />
        </Grafico>
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-suave">Lado a lado</h2>
        <p className="mb-2 text-xs leading-relaxed text-suave">
          Clique num nome para abrir só ele. As três últimas colunas são{' '}
          <strong className="text-texto">deste instante</strong>, não do período.
        </p>
        {trabalharam.length === 0 ? (
          <Vazio icone={<Flame size={20} />}>
            Ninguém abriu conversa neste período. Experimente um recorte maior.
          </Vazio>
        ) : (
          <Cartao className="overflow-x-auto">
            <table className="w-full min-w-[980px] text-sm">
              <thead>
                <tr className="border-b border-borda text-left">
                  {[
                    ['Atendente', ''],
                    ['Pessoas', 'Pessoas distintas com quem abriu conversa no período'],
                    ['Conversas', 'Vezes que clicou em "Abrir conversa"'],
                    ['Dias', 'Dias em que abriu pelo menos uma conversa'],
                    ['Horas', 'Horas distintas com atividade, somadas no período'],
                    ['Por dia', 'Pessoas por dia trabalhado'],
                    ['Autorizou', ''],
                    ['Taxa', 'Autorizações sobre pessoas abordadas'],
                    ['Cliques', 'Abriram o material'],
                    ['Reservados', 'Agora'],
                    ['Aguardando', 'Agora'],
                    ['Sem falar', 'Pegou e ainda não chamou — agora'],
                  ].map(([c, dica], i) => (
                    <th key={c} title={dica || undefined}
                        className={cx('px-4 py-2.5 text-xs font-medium text-suave',
                          i > 0 && 'text-right')}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-borda">
                {trabalharam.map((a) => (
                  <tr key={a.atendente_id}>
                    <td className="px-4 py-2.5">
                      <Link href={link({ atendente: a.atendente_id })} scroll={false}
                            className="flex items-center gap-2 font-medium hover:underline hover:underline-offset-4">
                        <Avatar nome={a.atendente} fotoUrl={a.foto_url} tamanho="p" />
                        {a.atendente}
                        {!a.ativo && <span className="text-xs font-normal text-suave">inativo</span>}
                      </Link>
                    </td>
                    <Celula>{numero(a.pessoas)}</Celula>
                    <Celula>{numero(a.aberturas)}</Celula>
                    <Celula>{numero(a.dias_trabalhados)}</Celula>
                    <Celula>{numero(a.horas_ativas)}</Celula>
                    <Celula>{porDiaTrabalhado(a).toFixed(1).replace('.', ',')}</Celula>
                    <Celula>{numero(a.autorizou)}</Celula>
                    <Celula>{taxa(a.autorizou, a.pessoas)}</Celula>
                    <Celula>{numero(a.cliques)}</Celula>
                    <Celula suave>{numero(a.na_mao_agora)}</Celula>
                    <Celula suave>{numero(a.aguardando_resposta)}</Celula>
                    <Celula suave>{numero(a.abertos_sem_falar)}</Celula>
                  </tr>
                ))}
              </tbody>
            </table>
          </Cartao>
        )}
      </section>

      <section className="mt-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metrica
          rotulo="Dias com trabalho" valor={relatorio.jornada.length}
          icone={<CalendarDays size={14} />}
          detalhe="Dias em que ao menos um atendente abriu conversa."
        />
        <Metrica
          rotulo="Média por dia" valor={
            relatorio.jornada.length > 0
              ? Math.round(relatorio.dias.reduce((s, d) => s + d.pessoas, 0) / relatorio.jornada.length)
              : 0
          }
          icone={<TrendingUp size={14} />}
          detalhe="Pessoas abordadas por dia com trabalho."
        />
        <Metrica
          rotulo="Primeiro a falar" valor={
            relatorio.jornada.length > 0
              ? relogio(Math.min(...relatorio.jornada.map((j) => j.inicio)))
              : '—'
          }
          icone={<Clock size={14} />}
          detalhe="A conversa mais cedo do período."
        />
        <Metrica
          rotulo="Último a falar" valor={
            relatorio.jornada.length > 0
              ? relogio(Math.max(...relatorio.jornada.map((j) => j.fim)))
              : '—'
          }
          icone={<Clock size={14} />}
          detalhe="A conversa mais tarde do período."
        />
      </section>
    </>
  );
}

function Celula({ children, suave }: { children: React.ReactNode; suave?: boolean }) {
  return (
    <td className={cx('px-4 py-2.5 text-right tabular-nums', suave && 'text-suave')}>
      {children}
    </td>
  );
}
