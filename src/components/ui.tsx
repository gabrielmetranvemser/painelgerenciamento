import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';
import { corDaLista } from '@/lib/cor-lista';
import type { OrigemContato } from '@/lib/tipos-banco';

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

/* ── Blocos ────────────────────────────────────────────────────────────────
 * A borda superior clara por dentro (--brilho) é o truque que dá a sensação
 * de material: a luz bate em cima e a sombra cai embaixo. Sem ela o card fica
 * parecendo um retângulo desenhado.
 */
export function Cartao({
  children, className, elevado,
}: { children: ReactNode; className?: string; elevado?: boolean }) {
  return (
    <div
      className={cx(
        'rounded-bloco border border-borda bg-superficie',
        'shadow-[var(--brilho),var(--sombra)]',
        elevado && 'shadow-[var(--brilho),var(--sombra-alta)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Vidro fosco. Só onde existe conteúdo passando por trás. */
export function Vidro({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cx(
        'rounded-bloco border border-borda bg-vidro backdrop-blur-2xl backdrop-saturate-150',
        'shadow-[var(--brilho),var(--sombra)]',
        className,
      )}
    >
      {children}
    </div>
  );
}

/* ── Botões ─────────────────────────────────────────────────────────────── */

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-full font-medium tracking-tight ' +
  'transition-[background,color,transform,box-shadow] duration-150 active:scale-[.985] ' +
  'disabled:cursor-not-allowed disabled:opacity-45 disabled:active:scale-100';

const TAM = {
  g: 'px-7 py-4 text-[15px]',
  m: 'px-5 py-2.5 text-sm',
  p: 'px-3.5 py-1.5 text-xs',
} as const;

const VAR = {
  principal:
    'bg-acento text-tinta-acento hover:bg-acento-alto ' +
    'shadow-[0_1px_0_0_rgba(255,255,255,.35)_inset,0_8px_24px_-12px_color-mix(in_oklab,var(--acento)_70%,transparent)]',
  neutro: 'border border-borda bg-superficie-alta text-texto hover:border-borda-forte',
  perigo: 'border border-perigo/35 bg-perigo/10 text-perigo hover:bg-perigo/16',
  fantasma: 'text-suave hover:text-texto hover:bg-superficie-alta',
} as const;

type Variante = keyof typeof VAR;
type Tamanho = keyof typeof TAM;

export function Botao({
  variante = 'principal', tamanho = 'm', className, ...props
}: ComponentProps<'button'> & { variante?: Variante; tamanho?: Tamanho }) {
  return <button {...props} className={cx(BASE, TAM[tamanho], VAR[variante], className)} />;
}

export function BotaoLink({
  variante = 'principal', tamanho = 'm', className, ...props
}: ComponentProps<typeof Link> & { variante?: Variante; tamanho?: Tamanho }) {
  return <Link {...props} className={cx(BASE, TAM[tamanho], VAR[variante], className)} />;
}

/* ── Campos ─────────────────────────────────────────────────────────────── */

const CAMPO =
  'w-full rounded-2xl border border-borda bg-superficie-alta px-4 py-3 text-[15px] text-texto ' +
  'placeholder:text-tenue transition-colors focus:border-borda-forte';

export function Campo({
  rotulo, dica, className, ...props
}: ComponentProps<'input'> & { rotulo: string; dica?: string }) {
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-texto">{rotulo}</span>
      <input {...props} className={cx(CAMPO, className)} />
      {dica && <span className="mt-2 block text-xs leading-relaxed text-suave">{dica}</span>}
    </label>
  );
}

export function AreaTexto({
  rotulo, dica, className, ...props
}: ComponentProps<'textarea'> & { rotulo?: string; dica?: string }) {
  const campo = <textarea {...props} className={cx(CAMPO, 'resize-y leading-relaxed', className)} />;
  if (!rotulo) return campo;
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-texto">{rotulo}</span>
      {campo}
      {dica && <span className="mt-2 block text-xs leading-relaxed text-suave">{dica}</span>}
    </label>
  );
}

export function Selecao({
  rotulo, dica, compacto, className, children, ...props
}: ComponentProps<'select'> & { rotulo?: string; dica?: string; compacto?: boolean }) {
  // `compacto` NÃO é o campo com classes extras: é uma base própria. Somar
  // `w-auto` ao `w-full` da base não resolveria — no Tailwind quem vence é a
  // ordem das regras no CSS, não a ordem das classes no atributo.
  const base = compacto
    ? 'rounded-full border border-borda bg-superficie-alta px-4 py-2 text-sm text-texto'
    : cx(CAMPO, 'appearance-none');
  const campo = <select {...props} className={cx(base, className)}>{children}</select>;
  if (!rotulo) return campo;
  return (
    <label className="block">
      <span className="mb-2 block text-[13px] font-semibold text-texto">{rotulo}</span>
      {campo}
      {dica && <span className="mt-2 block text-xs leading-relaxed text-suave">{dica}</span>}
    </label>
  );
}

/* ── Avisos ─────────────────────────────────────────────────────────────── */

const TOM = {
  info: 'border-borda bg-superficie-alta text-suave',
  ok: 'border-ok/25 bg-ok/10 text-ok',
  alerta: 'border-alerta/25 bg-alerta/10 text-alerta',
  erro: 'border-perigo/30 bg-perigo/10 text-perigo',
} as const;

export function Aviso({
  tom = 'info', children, className, icone,
}: { tom?: keyof typeof TOM; children: ReactNode; className?: string; icone?: ReactNode }) {
  return (
    <div
      role={tom === 'erro' ? 'alert' : undefined}
      className={cx('flex gap-3 rounded-2xl border px-4 py-3.5 text-sm leading-relaxed', TOM[tom], className)}
    >
      {icone && <span className="mt-px shrink-0">{icone}</span>}
      <div className="min-w-0">{children}</div>
    </div>
  );
}

/* ── Pílulas ────────────────────────────────────────────────────────────── */

export function Pilula({
  children, cor = 'neutro', className,
}: {
  children: ReactNode;
  cor?: 'neutro' | 'acento' | 'quente' | 'frio' | 'alerta' | 'perigo';
  className?: string;
}) {
  const cores = {
    neutro: 'border-borda bg-superficie-alta text-suave',
    acento: 'border-acento/25 bg-acento/12 text-acento',
    quente: 'border-quente/25 bg-quente/12 text-quente',
    frio: 'border-frio/25 bg-frio/12 text-frio',
    alerta: 'border-alerta/25 bg-alerta/12 text-alerta',
    perigo: 'border-perigo/25 bg-perigo/12 text-perigo',
  } as const;
  return (
    <span className={cx(
      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold',
      cores[cor], className,
    )}>
      {children}
    </span>
  );
}

/** Quente e frio nunca se misturam na tela — a cor é parte da regra. */
export function EtiquetaOrigem({ origem }: { origem: OrigemContato }) {
  const texto: Record<OrigemContato, string> = {
    site: 'Cadastrou no site',
    kit: 'Pediu o kit',
    lista_fria: 'Lista fria',
    chamou: 'Chamou no WhatsApp',
  };
  return <Pilula cor={origem === 'lista_fria' ? 'frio' : 'quente'}>{texto[origem]}</Pilula>;
}

/**
 * O ponto que identifica uma lista.
 *
 * Cor por `style`, e não por classe: a cor sai do id em tempo de execução, e
 * classe do Tailwind montada por interpolação não chega a existir no CSS.
 */
export function PontoLista({ id, className }: { id: string; className?: string }) {
  return (
    <span
      aria-hidden
      style={{ background: corDaLista(id) }}
      className={cx('inline-block size-2 shrink-0 rounded-full', className)}
    />
  );
}

/**
 * De que lista veio este contato.
 *
 * Pílula NEUTRA com um ponto colorido — de propósito. A cor cheia da pílula já
 * quer dizer outra coisa na tela do atendente (âmbar é fila quente, azul-gelo é
 * fila fria), e a etiqueta de lista não pode disputar esse significado.
 */
export function EtiquetaLista({ id, nome }: { id: string; nome: string }) {
  return (
    <Pilula>
      <PontoLista id={id} />
      <span className="max-w-[12rem] truncate">{nome}</span>
    </Pilula>
  );
}

/* ── Métrica ────────────────────────────────────────────────────────────── */

export function Metrica({
  rotulo, valor, detalhe, tom, icone,
}: {
  rotulo: string;
  valor: number | string;
  detalhe?: string;
  tom?: 'acento' | 'quente' | 'frio' | 'alerta' | 'perigo';
  icone?: ReactNode;
}) {
  // Mapa estático, não interpolação: o Tailwind varre o código em busca de
  // nomes de classe literais, e `text-${tom}` nunca chegaria a existir no CSS.
  const cor = {
    acento: 'text-acento', quente: 'text-quente', frio: 'text-frio',
    alerta: 'text-alerta', perigo: 'text-perigo',
  } as const;
  const classe = tom ? cor[tom] : 'text-texto';
  return (
    <Cartao className="p-5">
      <div className="mb-3 flex items-center gap-2 text-suave">
        {icone}
        <span className="text-[11px] font-semibold uppercase tracking-[0.08em]">{rotulo}</span>
      </div>
      <p className={cx('font-display text-4xl font-semibold leading-none tabular', classe)}>
        {typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
      </p>
      {detalhe && <p className="mt-2 text-xs leading-relaxed text-suave">{detalhe}</p>}
    </Cartao>
  );
}

/* ── Farol do chip (docs/03-OPERACAO.md §7) ─────────────────────────────── */

const FAROL = {
  verde:     { cor: 'acento' as const, texto: 'Saudável' },
  amarelo:   { cor: 'alerta' as const, texto: 'Atenção' },
  vermelho:  { cor: 'perigo' as const, texto: 'Trocar pelo reserva' },
  sem_dados: { cor: 'neutro' as const, texto: 'Poucos dados' },
};

export function Farol({ estado }: { estado: keyof typeof FAROL }) {
  const { cor, texto } = FAROL[estado];
  return (
    <Pilula cor={cor}>
      <span className={cx(
        'size-1.5 rounded-full',
        estado === 'verde' ? 'bg-acento' : estado === 'amarelo' ? 'bg-alerta'
          : estado === 'vermelho' ? 'bg-perigo' : 'bg-tenue',
      )} />
      {texto}
    </Pilula>
  );
}

/* ── Avatar ─────────────────────────────────────────────────────────────── */

/** Matiz derivada do nome: a mesma pessoa tem sempre a mesma cor. */
function matiz(nome: string) {
  let h = 0;
  for (let i = 0; i < nome.length; i++) h = (h * 31 + nome.charCodeAt(i)) % 360;
  return h;
}

export function Avatar({
  nome, fotoUrl, tamanho = 'm', className,
}: {
  nome: string | null | undefined;
  fotoUrl?: string | null;
  tamanho?: 'p' | 'm' | 'g';
  className?: string;
}) {
  const dims = { p: 'size-7 text-[11px]', m: 'size-10 text-sm', g: 'size-14 text-lg' }[tamanho];
  const limpo = (nome ?? '').trim();
  const iniciais = limpo
    ? limpo.split(/\s+/).slice(0, 2).map((p) => p[0]).join('').toLocaleUpperCase('pt-BR')
    : '·';
  const h = matiz(limpo || 'sem-nome');

  if (fotoUrl) {
    return (
      // Foto vem de URL informada pelo gestor; next/image exigiria configurar
      // domínios remotos para um avatar de 40px.
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={fotoUrl}
        alt={limpo || 'Foto'}
        className={cx(dims, 'shrink-0 rounded-full border border-borda object-cover', className)}
      />
    );
  }

  return (
    <span
      aria-hidden
      className={cx(dims, 'grid shrink-0 place-items-center rounded-full border font-bold', className)}
      style={{
        background: `oklch(0.32 0.07 ${h})`,
        borderColor: `oklch(0.45 0.09 ${h})`,
        color: `oklch(0.92 0.09 ${h})`,
      }}
    >
      {iniciais}
    </span>
  );
}

/* ── Vazio ──────────────────────────────────────────────────────────────── */

export function Vazio({ children, icone }: { children: ReactNode; icone?: ReactNode }) {
  return (
    <Cartao className="grid place-items-center gap-3 px-6 py-14 text-center">
      {icone && <span className="text-tenue">{icone}</span>}
      <p className="max-w-sm text-sm leading-relaxed text-suave">{children}</p>
    </Cartao>
  );
}

/* ── Título de página ───────────────────────────────────────────────────── */

export function Titulo({
  children, sub, acao,
}: { children: ReactNode; sub?: ReactNode; acao?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-end gap-4">
      <div className="mr-auto">
        <h1 className="font-display text-3xl font-semibold tracking-tight">{children}</h1>
        {sub && <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-suave">{sub}</p>}
      </div>
      {acao}
    </header>
  );
}
