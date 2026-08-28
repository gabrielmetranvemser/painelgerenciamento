'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Clock, Inbox, Loader2, Search } from 'lucide-react';
import { Avatar, Cartao, EtiquetaOrigem, Pilula, Vazio, cx } from '@/components/ui';
import { rotas } from '@/lib/links-internos';
import { formatarExibicao } from '@/lib/telefone';
import {
  COR_STATUS_CONTATO, ROTULO_STATUS_CONTATO, type StatusContato,
} from '@/lib/tipos-banco';
import { STATUS_MEUS_CONTATOS, type MeuContato, type RespostaMeusContatos } from './recortes';

/**
 * A lista, com as abas de desfecho e a busca.
 *
 * ⚠️ Os filtros vivem na URL, e não no estado do componente — é o que permite o
 * SERVIDOR fazer o recorte, e é o que faz o botão "voltar" do navegador
 * funcionar. Mesmo desenho da tela de contatos do gestor.
 */
export function ListaMeusContatos({
  dados, status, busca, pagina, porPagina, entrada,
}: {
  dados: RespostaMeusContatos;
  status: StatusContato | 'todos';
  busca: string;
  pagina: number;
  porPagina: number;
  /**
   * O segmento secreto da URL. Vem como TEXTO, e não como uma função que monta
   * a rota: função não atravessa a fronteira servidor→cliente, e `rotas()` é
   * montado a partir daqui de propósito, para a chave nunca ir para o pacote
   * JavaScript (CLAUDE.md, regra 7).
   */
  entrada: string;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const params = useSearchParams();
  const [ocupado, iniciar] = useTransition();
  const [termo, setTermo] = useState(busca);

  function irPara(mudancas: Record<string, string | null>) {
    const p = new URLSearchParams(params.toString());
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor === null || valor === '') p.delete(chave);
      else p.set(chave, valor);
    }
    // Trocar de aba ou de busca sempre volta para a primeira página: manter a
    // página 3 de um recorte com duas páginas mostra tela vazia.
    if (!('pagina' in mudancas)) p.delete('pagina');
    iniciar(() => router.push(`${caminho}?${p.toString()}`));
  }

  // A busca espera a digitação parar. Sem isso é uma ida ao servidor por tecla.
  useEffect(() => {
    if (termo === busca) return;
    const t = setTimeout(() => irPara({ busca: termo }), 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [termo]);

  // Só as abas que têm alguém. Um atendente que nunca marcou "Mudou de estado"
  // não precisa de um botão zerado ocupando a faixa.
  const abas = STATUS_MEUS_CONTATOS.filter((s) => (dados.contagens[s] ?? 0) > 0);
  const paginas = Math.max(1, Math.ceil(dados.total / porPagina));
  const r = rotas(entrada);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Aba ativo={status === 'todos'} contagem={dados.todos} ocupado={ocupado}
             aoClicar={() => irPara({ status: null })}>
          Todos
        </Aba>
        {abas.map((s) => (
          <Aba key={s} ativo={status === s} contagem={dados.contagens[s] ?? 0} ocupado={ocupado}
               aoClicar={() => irPara({ status: s })}>
            {ROTULO_STATUS_CONTATO[s]}
          </Aba>
        ))}
      </div>

      <label className="relative block">
        <Search size={15} className="pointer-events-none absolute left-4 top-1/2 -translate-y-1/2 text-tenue" />
        <input
          value={termo} onChange={(e) => setTermo(e.target.value)}
          placeholder="Buscar por nome ou telefone"
          aria-label="Buscar nos seus contatos"
          className="w-full rounded-2xl border border-borda bg-superficie-alta py-2.5 pl-11 pr-4 text-sm placeholder:text-tenue"
        />
        {ocupado && (
          <Loader2 size={15} className="absolute right-4 top-1/2 -translate-y-1/2 animate-spin text-tenue" />
        )}
      </label>

      {dados.linhas.length === 0 ? (
        <Vazio icone={<Inbox size={26} />}>
          {dados.todos === 0
            ? 'Você ainda não abordou ninguém. Quem você atender aparece aqui.'
            : 'Ninguém neste recorte. Tente outra aba ou limpe a busca.'}
        </Vazio>
      ) : (
        <Cartao className="divide-y divide-borda overflow-hidden">
          {dados.linhas.map((c) => <Linha key={c.id} contato={c} href={r.contato(c.id)} />)}
        </Cartao>
      )}

      {paginas > 1 && (
        <div className="flex items-center justify-center gap-3">
          <button type="button" disabled={pagina === 0 || ocupado}
                  onClick={() => irPara({ pagina: String(pagina - 1) })}
                  className="grid size-9 place-items-center rounded-full border border-borda text-suave transition-colors enabled:hover:text-texto disabled:opacity-40">
            <ChevronLeft size={16} />
          </button>
          <span className="text-xs text-suave">
            página {pagina + 1} de {paginas} · {dados.total.toLocaleString('pt-BR')} contatos
          </span>
          <button type="button" disabled={pagina + 1 >= paginas || ocupado}
                  onClick={() => irPara({ pagina: String(pagina + 1) })}
                  className="grid size-9 place-items-center rounded-full border border-borda text-suave transition-colors enabled:hover:text-texto disabled:opacity-40">
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}

function Aba({
  children, contagem, ativo, ocupado, aoClicar,
}: {
  children: React.ReactNode;
  contagem: number;
  ativo: boolean;
  ocupado: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button" onClick={aoClicar} disabled={ocupado} aria-pressed={ativo}
      className={cx(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        ativo
          ? 'border-acento/40 bg-acento/12 text-acento'
          : 'border-borda bg-superficie text-suave enabled:hover:border-borda-forte enabled:hover:text-texto',
      )}
    >
      {children}
      <span className="tabular-nums opacity-70">{contagem.toLocaleString('pt-BR')}</span>
    </button>
  );
}

function Linha({ contato: c, href }: { contato: MeuContato; href: string }) {
  const quando = c.resultado_em ?? c.primeiro_contato_em;
  // "Falar depois" é o único desfecho que tem futuro: mostrar QUANDO volta é o
  // que transforma a lista em agenda.
  const volta = c.status === 'falar_depois' && c.adiado_ate
    ? new Date(c.adiado_ate)
    : null;
  // Do servidor: ver `pode_falar` em `recortes.ts`.
  const jaVoltou = c.pode_falar;

  return (
    <Link href={href}
          className="flex flex-wrap items-center gap-4 px-5 py-4 transition-colors hover:bg-superficie-alta">
      <Avatar nome={c.nome ?? c.primeiro_nome} tamanho="m" />
      <div className="mr-auto min-w-0">
        <p className="truncate font-semibold">
          {c.primeiro_nome ?? c.nome ?? <span className="text-tenue">(dados apagados)</span>}
        </p>
        <p className="truncate text-xs text-suave">
          {c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '—'}
          {c.municipio && ` · ${c.municipio}`}
          {quando && ` · ${new Date(quando).toLocaleDateString('pt-BR')}`}
        </p>
        {volta && (
          <p className={cx('mt-0.5 flex items-center gap-1 text-xs',
            jaVoltou ? 'text-acento' : 'text-suave')}>
            <Clock size={11} />
            {jaVoltou
              ? 'já pode falar — ele volta na sua fila'
              : `volta em ${volta.toLocaleDateString('pt-BR')}`}
          </p>
        )}
        {c.encaminhamento && (
          <p className="mt-0.5 truncate text-xs text-suave">pediu: {c.encaminhamento}</p>
        )}
      </div>
      <EtiquetaOrigem origem={c.origem} />
      <Pilula cor={COR_STATUS_CONTATO[c.status]}>{ROTULO_STATUS_CONTATO[c.status]}</Pilula>
      <ChevronRight size={16} className="text-tenue" />
    </Link>
  );
}
