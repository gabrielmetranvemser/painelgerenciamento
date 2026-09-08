/**
 * Os gráficos do painel do gestor — SVG escrito à mão, desenhado no servidor.
 *
 * ⚠️ SEM `'use client'` e sem biblioteca de gráfico, de propósito.
 *
 * Nada aqui precisa de estado: os números já vêm somados do banco e a página é
 * um Server Component. Uma biblioteca traria de 40 a 100 kB de JavaScript para
 * o navegador de quem abre a tela — e o painel é usado o dia inteiro, muitas
 * vezes num notebook barato. O que o gráfico precisa mostrar ao passar o mouse
 * mora em `<title>`, que o navegador desenha sozinho, sem uma linha de script.
 *
 * ⚠️ Cor vem de `var(--token)` no atributo, nunca de classe do Tailwind montada
 * por interpolação: a varredura do Tailwind só enxerga nome literal, e
 * `fill-${cor}` não chega a existir no CSS (CLAUDE.md, sistema visual).
 *
 * ⚠️ Todo gráfico tem largura mínima e rola de lado no celular. Encolher o SVG
 * para caber encolhe junto o texto dos eixos — a mesma decisão que as tabelas
 * desta área já tomaram com `min-w-[860px]`.
 */
import type { ReactNode } from 'react';
import { Cartao, cx } from '@/components/ui';

/* ── Moldura ────────────────────────────────────────────────────────────── */

export function Grafico({
  titulo, dica, acao, children, className,
}: {
  titulo: string;
  dica?: ReactNode;
  acao?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Cartao className={cx('p-5', className)}>
      <div className="mb-4 flex flex-wrap items-start gap-3">
        <div className="mr-auto min-w-0">
          <h3 className="text-sm font-semibold">{titulo}</h3>
          {dica && <p className="mt-1 text-xs leading-relaxed text-suave">{dica}</p>}
        </div>
        {acao}
      </div>
      {children}
    </Cartao>
  );
}

/** Rola de lado no celular em vez de espremer o texto do eixo. */
function Rolagem({ minimo, children }: { minimo: number; children: ReactNode }) {
  return (
    <div className="-mx-1 overflow-x-auto px-1">
      <div style={{ minWidth: minimo }}>{children}</div>
    </div>
  );
}

function SemDados({ children }: { children: ReactNode }) {
  return (
    <div className="grid place-items-center rounded-2xl border border-dashed border-borda px-4 py-10 text-center">
      <p className="max-w-xs text-xs leading-relaxed text-suave">{children}</p>
    </div>
  );
}

/**
 * Um rótulo a cada N barras.
 *
 * Com 90 dias, escrever a data debaixo de cada uma vira uma tarja preta: as
 * letras se encostam e não se lê nenhuma. Melhor mostrar oito e deixar o resto
 * para o `<title>` de cada barra.
 */
function passo(quantidade: number, cabem: number): number {
  return Math.max(1, Math.ceil(quantidade / cabem));
}

/* ── Barras por dia ─────────────────────────────────────────────────────── */

export function BarrasPorDia({
  dados, cor = 'var(--acento)', altura = 168,
}: {
  dados: { rotulo: string; titulo: string; valor: number }[];
  cor?: string;
  altura?: number;
}) {
  if (dados.length === 0) return <SemDados>Nenhuma conversa no período.</SemDados>;

  const L = Math.max(560, dados.length * 26);
  const baixo = 24;
  const alto = 10;
  const util = altura - baixo - alto;
  const maior = Math.max(...dados.map((d) => d.valor), 1);
  const larguraCelula = L / dados.length;
  const largura = Math.max(3, Math.min(larguraCelula - 4, 26));
  const cada = passo(dados.length, 12);

  return (
    <Rolagem minimo={L}>
      <svg viewBox={`0 0 ${L} ${altura}`} className="h-auto w-full" role="img">
        {/* Três linhas de referência. Mais que isso vira grade de planilha. */}
        {[0, 0.5, 1].map((f) => (
          <line key={f} x1={0} x2={L} y1={alto + util * f} y2={alto + util * f}
                stroke="var(--borda)" strokeWidth={1} />
        ))}

        {dados.map((d, i) => {
          const h = d.valor === 0 ? 0 : Math.max(2, (d.valor / maior) * util);
          const x = i * larguraCelula + (larguraCelula - largura) / 2;
          return (
            <g key={d.rotulo + i}>
              <title>{d.titulo}</title>
              {/* Fundo fraco em toda a coluna: o dia parado fica visível como
                  buraco, em vez de sumir e colar dois dias de trabalho. */}
              <rect x={x} y={alto} width={largura} height={util}
                    rx={Math.min(largura / 2, 4)} fill="var(--vidro)" />
              {h > 0 && (
                <rect x={x} y={alto + util - h} width={largura} height={h}
                      rx={Math.min(largura / 2, 4)} fill={cor} />
              )}
              {i % cada === 0 && (
                <text x={x + largura / 2} y={altura - 7} textAnchor="middle"
                      fontSize={11} fill="var(--tenue)">
                  {d.rotulo}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Rolagem>
  );
}

/* ── Barras por hora do dia ─────────────────────────────────────────────── */

export function BarrasPorHora({
  horas, janela,
}: {
  horas: { hora: number; valor: number }[];
  /** A janela de horário da campanha, para marcar o que está fora dela. */
  janela?: { inicio: number; fim: number };
}) {
  const total = horas.reduce((s, h) => s + h.valor, 0);
  if (total === 0) return <SemDados>Nenhuma conversa aberta no período.</SemDados>;

  const L = 600;
  const altura = 150;
  const baixo = 22;
  const alto = 8;
  const util = altura - baixo - alto;
  const maior = Math.max(...horas.map((h) => h.valor), 1);
  const celula = L / 24;
  const largura = celula - 5;

  return (
    <Rolagem minimo={L}>
      <svg viewBox={`0 0 ${L} ${altura}`} className="h-auto w-full" role="img">
        <line x1={0} x2={L} y1={alto + util} y2={alto + util} stroke="var(--borda)" strokeWidth={1} />
        {horas.map((h) => {
          const dentro = !janela || (h.hora >= janela.inicio && h.hora < janela.fim);
          const altura2 = h.valor === 0 ? 0 : Math.max(2, (h.valor / maior) * util);
          const x = h.hora * celula + 2.5;
          return (
            <g key={h.hora}>
              {/* ⚠️ Uma expressão só. Duas viram um array de dois filhos, e o
                  React recusa: o navegador trata tudo dentro de <title> como um
                  texto corrido. Fica sem dica nenhuma justamente na barra que
                  o gestor vai querer conferir. */}
              <title>{
                `${String(h.hora).padStart(2, '0')}h — ${h.valor} conversa${h.valor === 1 ? '' : 's'}`
                + (dentro ? '' : ' (fora da janela de horário)')
              }</title>
              {altura2 > 0 && (
                <rect x={x} y={alto + util - altura2} width={largura} height={altura2}
                      rx={Math.min(largura / 2, 4)}
                      // ⚠️ Fora da janela é âmbar, e não vermelho: a janela é
                      // regra do gestor, não da lei. Vermelho aqui misturaria
                      // com o que de fato é risco jurídico na tela ao lado.
                      fill={dentro ? 'var(--frio)' : 'var(--alerta)'} />
              )}
              {h.hora % 3 === 0 && (
                <text x={x + largura / 2} y={altura - 6} textAnchor="middle"
                      fontSize={11} fill="var(--tenue)">
                  {String(h.hora).padStart(2, '0')}h
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </Rolagem>
  );
}

/* ── Faixas de jornada ──────────────────────────────────────────────────── */

/**
 * Da primeira à última conversa de cada dia.
 *
 * ⚠️ Isto NÃO é ponto eletrônico, e a tela precisa dizer isso em voz alta onde
 * o gestor lê. O painel não sabe quando alguém sentou nem quando levantou —
 * sabe quando abriu conversa. Quem passou a manhã organizando a base e só
 * começou a falar às 14h aparece aqui como quem chegou às 14h.
 */
export function FaixasDeJornada({
  dias, inicioDoEixo = 6, fimDoEixo = 22,
}: {
  dias: { rotulo: string; titulo: string; inicio: number; fim: number; intensidade: number }[];
  inicioDoEixo?: number;
  fimDoEixo?: number;
}) {
  if (dias.length === 0) return <SemDados>Nenhum dia com conversa no período.</SemDados>;

  // O eixo se abre se alguém trabalhou fora dele — nada pode ficar de fora do
  // desenho justamente por ser a exceção que o gestor quer ver.
  const cedo = Math.min(inicioDoEixo, ...dias.map((d) => Math.floor(d.inicio / 60)));
  const tarde = Math.max(fimDoEixo, ...dias.map((d) => Math.ceil(d.fim / 60)));

  const rotuloL = 62;
  const L = 620;
  const linha = 22;
  const altura = dias.length * linha + 24;
  const eixo = L - rotuloL;
  const span = Math.max(1, (tarde - cedo) * 60);
  const x = (min: number) => rotuloL + ((min - cedo * 60) / span) * eixo;
  const cada = passo(tarde - cedo, 9);

  return (
    <Rolagem minimo={L}>
      <svg viewBox={`0 0 ${L} ${altura}`} className="h-auto w-full" role="img">
        {Array.from({ length: tarde - cedo + 1 }, (_, i) => cedo + i)
          .filter((h) => (h - cedo) % cada === 0)
          .map((h) => (
            <g key={h}>
              <line x1={x(h * 60)} x2={x(h * 60)} y1={0} y2={dias.length * linha}
                    stroke="var(--borda)" strokeWidth={1} />
              <text x={x(h * 60)} y={altura - 7} textAnchor="middle"
                    fontSize={11} fill="var(--tenue)">
                {String(h).padStart(2, '0')}h
              </text>
            </g>
          ))}

        {dias.map((d, i) => {
          const y = i * linha + 4;
          const esq = x(d.inicio);
          // Um dia com uma conversa só tem largura zero e sumiria da tela — e
          // "trabalhou pouco" é uma informação, não uma ausência.
          const larg = Math.max(6, x(d.fim) - esq);
          return (
            <g key={d.rotulo + i}>
              <title>{d.titulo}</title>
              <text x={rotuloL - 8} y={y + 11} textAnchor="end" fontSize={11} fill="var(--suave)">
                {d.rotulo}
              </text>
              <rect x={esq} y={y} width={larg} height={linha - 8} rx={(linha - 8) / 2}
                    fill="var(--acento)"
                    // A opacidade conta o volume: dia cheio fica sólido, dia de
                    // três conversas fica pálido, e o gestor lê os dois de uma vez.
                    opacity={0.35 + 0.65 * Math.min(1, d.intensidade)} />
            </g>
          );
        })}
      </svg>
    </Rolagem>
  );
}

/* ── Barra de grupos (proporção) ────────────────────────────────────────── */

export function BarraDeGrupos({
  partes, altura = 12,
}: {
  partes: { chave: string; rotulo: string; valor: number; cor: string }[];
  altura?: number;
}) {
  const total = partes.reduce((s, p) => s + p.valor, 0);
  if (total === 0) {
    return <div className="h-3 rounded-full border border-dashed border-borda" />;
  }

  // As posições saem de uma varredura ANTES do desenho, e não de um
  // acumulador dentro do `map`: reatribuir variável durante a renderização é
  // erro de lint neste projeto (react-hooks/immutability) — e o motivo é bom,
  // porque o `map` pode ser reexecutado.
  const pedacos = partes.reduce<{ chave: string; rotulo: string; valor: number; cor: string; x: number }[]>(
    (acc, p) => {
      const anterior = acc[acc.length - 1];
      const x = anterior ? anterior.x + (anterior.valor / total) * 100 : 0;
      return [...acc, { ...p, x }];
    },
    [],
  );

  return (
    <svg viewBox={`0 0 100 ${altura}`} preserveAspectRatio="none"
         className="w-full" style={{ height: altura }} role="img">
      {/* O recorte arredondado vai no conjunto, não em cada pedaço: pedaço
          arredondado por dentro deixa falha branca entre as cores. */}
      <defs>
        <clipPath id="barra-de-grupos">
          <rect x={0} y={0} width={100} height={altura} rx={altura / 2} ry={altura / 2} />
        </clipPath>
      </defs>
      <g clipPath="url(#barra-de-grupos)">
        {pedacos.filter((p) => p.valor > 0).map((p) => (
          <rect key={p.chave} x={p.x} y={0} width={(p.valor / total) * 100} height={altura}
                fill={p.cor}>
            <title>{`${p.rotulo}: ${p.valor.toLocaleString('pt-BR')}`}</title>
          </rect>
        ))}
      </g>
    </svg>
  );
}

/* ── Barras comparativas (ranking) ──────────────────────────────────────── */

export function BarrasComparativas({
  itens,
}: {
  itens: {
    chave: string;
    rotulo: string;
    valor: number;
    /** Os pedaços coloridos dentro da barra. Somados, dão `valor`. */
    partes?: { chave: string; rotulo: string; valor: number; cor: string }[];
    href?: string;
    detalhe?: string;
  }[];
}) {
  if (itens.length === 0) return <SemDados>Ninguém abriu conversa no período.</SemDados>;
  const maior = Math.max(...itens.map((i) => i.valor), 1);

  return (
    <ul className="space-y-2.5">
      {itens.map((i) => (
        <li key={i.chave}>
          <div className="mb-1 flex items-baseline gap-2">
            <span className="truncate text-[13px] font-medium">{i.rotulo}</span>
            {i.detalhe && <span className="truncate text-xs text-suave">{i.detalhe}</span>}
            <span className="ml-auto font-display text-sm font-semibold tabular">
              {i.valor.toLocaleString('pt-BR')}
            </span>
          </div>
          <div className="h-2.5 w-full overflow-hidden rounded-full bg-vidro">
            <div className="flex h-full overflow-hidden rounded-full"
                 style={{ width: `${Math.max(2, (i.valor / maior) * 100)}%` }}>
              {(i.partes ?? [{ chave: 'total', rotulo: i.rotulo, valor: i.valor, cor: 'var(--acento)' }])
                .filter((p) => p.valor > 0)
                .map((p) => (
                  <span key={p.chave}
                        title={`${p.rotulo}: ${p.valor.toLocaleString('pt-BR')}`}
                        style={{
                          width: `${(p.valor / Math.max(i.valor, 1)) * 100}%`,
                          background: p.cor,
                        }} />
                ))}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ── Legenda ────────────────────────────────────────────────────────────── */

export function Legenda({
  itens,
}: {
  itens: { chave: string; rotulo: string; cor: string; valor?: number; dica?: string }[];
}) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5">
      {itens.map((i) => (
        <li key={i.chave} className="flex items-center gap-1.5 text-xs" title={i.dica}>
          <span className="size-2 shrink-0 rounded-full" style={{ background: i.cor }} />
          <span className="text-suave">{i.rotulo}</span>
          {i.valor !== undefined && (
            <span className="font-medium tabular">{i.valor.toLocaleString('pt-BR')}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
