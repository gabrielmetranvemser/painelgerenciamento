import Link from 'next/link';
import type { ComponentProps, ReactNode } from 'react';

function juntar(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(' ');
}

const BASE_BOTAO =
  'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors ' +
  'disabled:cursor-not-allowed disabled:opacity-50';

const TAMANHOS = {
  g: 'px-6 py-3.5 text-base',
  m: 'px-4 py-2.5 text-sm',
  p: 'px-3 py-1.5 text-xs',
} as const;

const VARIANTES = {
  principal: 'bg-acento text-white hover:bg-acento-forte',
  neutro: 'border border-borda bg-superficie text-texto hover:bg-fundo',
  perigo: 'border border-perigo/40 bg-superficie text-perigo hover:bg-perigo/10',
  fantasma: 'text-suave hover:text-texto hover:bg-fundo',
} as const;

type BotaoProps = ComponentProps<'button'> & {
  variante?: keyof typeof VARIANTES;
  tamanho?: keyof typeof TAMANHOS;
};

export function Botao({ variante = 'principal', tamanho = 'm', className, ...props }: BotaoProps) {
  return (
    <button
      {...props}
      className={juntar(BASE_BOTAO, TAMANHOS[tamanho], VARIANTES[variante], className)}
    />
  );
}

type BotaoLinkProps = ComponentProps<typeof Link> & {
  variante?: keyof typeof VARIANTES;
  tamanho?: keyof typeof TAMANHOS;
};

export function BotaoLink({ variante = 'principal', tamanho = 'm', className, ...props }: BotaoLinkProps) {
  return (
    <Link {...props} className={juntar(BASE_BOTAO, TAMANHOS[tamanho], VARIANTES[variante], className)} />
  );
}

export function Campo({
  rotulo,
  dica,
  className,
  ...props
}: ComponentProps<'input'> & { rotulo: string; dica?: string }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium text-texto">{rotulo}</span>
      <input
        {...props}
        className={juntar(
          'w-full rounded-lg border border-borda bg-superficie px-3.5 py-2.5 text-base text-texto',
          'placeholder:text-suave',
          className,
        )}
      />
      {dica && <span className="mt-1.5 block text-xs text-suave">{dica}</span>}
    </label>
  );
}

const TOM_AVISO = {
  info: 'border-borda bg-superficie text-suave',
  ok: 'border-ok/30 bg-ok/10 text-ok',
  alerta: 'border-alerta/30 bg-alerta/10 text-alerta',
  erro: 'border-perigo/30 bg-perigo/10 text-perigo',
} as const;

export function Aviso({
  tom = 'info',
  children,
  className,
}: {
  tom?: keyof typeof TOM_AVISO;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      role={tom === 'erro' ? 'alert' : undefined}
      className={juntar('rounded-lg border px-4 py-3 text-sm', TOM_AVISO[tom], className)}
    >
      {children}
    </div>
  );
}

export function Cartao({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={juntar('rounded-xl border border-borda bg-superficie', className)}>{children}</div>
  );
}

/** Etiqueta da origem do contato. Quente e frio nunca se misturam na tela. */
export function EtiquetaOrigem({ origem }: { origem: 'site' | 'kit' | 'lista_fria' }) {
  const frio = origem === 'lista_fria';
  const texto = { site: 'Cadastrou no site', kit: 'Pediu o kit', lista_fria: 'Lista fria' }[origem];
  return (
    <span
      className={juntar(
        'inline-flex items-center rounded-full px-2.5 py-1 text-xs font-medium',
        frio ? 'bg-frio/10 text-frio' : 'bg-quente/10 text-quente',
      )}
    >
      {texto}
    </span>
  );
}

/** Número grande com rótulo. Base dos painéis do gestor. */
export function Metrica({
  rotulo, valor, detalhe, tom = '',
}: {
  rotulo: string;
  valor: number | string;
  detalhe?: string;
  tom?: string;
}) {
  return (
    <Cartao className="p-4">
      <p className={`text-2xl font-semibold tabular-nums ${tom}`}>
        {typeof valor === 'number' ? valor.toLocaleString('pt-BR') : valor}
      </p>
      <p className="mt-0.5 text-xs font-medium">{rotulo}</p>
      {detalhe && <p className="mt-0.5 text-xs text-suave">{detalhe}</p>}
    </Cartao>
  );
}

const CORES_FAROL = {
  verde: 'bg-ok/15 text-ok',
  amarelo: 'bg-alerta/15 text-alerta',
  vermelho: 'bg-perigo/15 text-perigo',
  sem_dados: 'bg-borda text-suave',
} as const;

const TEXTO_FAROL = {
  verde: 'Saudável',
  amarelo: 'Atenção',
  vermelho: 'Trocar pelo reserva',
  sem_dados: 'Poucos dados',
} as const;

/** Termômetro do chip (docs/03-OPERACAO.md §7). */
export function Farol({ estado }: { estado: keyof typeof CORES_FAROL }) {
  return (
    <span className={`inline-flex rounded-full px-2.5 py-1 text-xs font-medium ${CORES_FAROL[estado]}`}>
      {TEXTO_FAROL[estado]}
    </span>
  );
}

export function Vazio({ children }: { children: ReactNode }) {
  return <Cartao className="p-8 text-center text-sm text-suave">{children}</Cartao>;
}
