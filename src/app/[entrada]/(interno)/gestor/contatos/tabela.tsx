'use client';

import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useCallback, useEffect, useState, useTransition } from 'react';
import { ChevronLeft, ChevronRight, Loader2, MousePointerClick, PackageOpen, Search } from 'lucide-react';
import { Cartao, EtiquetaOrigem, Pilula, PontoLista, Selecao, cx } from '@/components/ui';
import { formatarExibicao } from '@/lib/telefone';
import type {
  Candidato, ContatoDoGestor, Lista, Municipio, StatusContato, Usuario,
} from '@/lib/tipos-banco';

const ROTULO_STATUS: Record<StatusContato, string> = {
  novo: 'Novo',
  na_fila: 'Na fila',
  em_atendimento: 'Aguardando resposta',
  autorizou: 'Autorizou',
  pediu_saida: 'Pediu saída',
  invalido: 'Número inválido',
  quer_ajudar: 'Quer ajudar',
  encaminhado: 'Encaminhado',
  sem_resposta: 'Não respondeu',
  perdido: 'Perdido',
};

const COR_STATUS: Record<StatusContato, 'neutro' | 'acento' | 'quente' | 'frio' | 'alerta' | 'perigo'> = {
  novo: 'neutro',
  na_fila: 'frio',
  em_atendimento: 'alerta',
  autorizou: 'acento',
  pediu_saida: 'perigo',
  invalido: 'neutro',
  quer_ajudar: 'acento',
  encaminhado: 'quente',
  sem_resposta: 'neutro',
  perdido: 'neutro',
};

/**
 * Atalhos de leitura, na ordem em que o gestor pergunta.
 *
 * "Pendente" não é um status do banco: é a pergunta que o gestor faz de manhã —
 * quem já foi chamado e ainda não deu resposta. No banco isso é
 * `em_atendimento` com a primeira mensagem já enviada.
 *
 * ⚠️ As chaves são as mesmas que `contatos_do_gestor` conhece. Acrescentar uma
 * aqui sem acrescentar lá faz a aba nova cair silenciosamente em "todos".
 */
export const RECORTES = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'pendentes', rotulo: 'Aguardando resposta' },
  { chave: 'na_fila', rotulo: 'Ainda não chamados' },
  { chave: 'autorizou', rotulo: 'Autorizaram' },
  { chave: 'pediu_saida', rotulo: 'Pediram saída' },
  { chave: 'kit', rotulo: 'Kit a entregar' },
] as const;

export type Recorte = (typeof RECORTES)[number]['chave'];
export type Contagens = Record<Recorte, number>;

export type Filtros = {
  recorte: Recorte;
  atendente: string;
  candidato: string;
  municipio: string;
  origem: string;
  /** Id da lista, ou `'sem'` para quem não veio de lista nenhuma. */
  lista: string;
  busca: string;
};

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function TabelaContatos({
  contatos, contagens, total, pagina, porPagina, filtros,
  atendentes, candidatos, municipios, listas, entrada,
}: {
  contatos: ContatoDoGestor[];
  contagens: Contagens;
  /** Quantos existem no recorte atual — não quantos vieram nesta página. */
  total: number;
  pagina: number;
  porPagina: number;
  filtros: Filtros;
  atendentes: Usuario[];
  candidatos: Candidato[];
  municipios: Municipio[];
  listas: Pick<Lista, 'id' | 'rotulo' | 'origem' | 'ativa'>[];
  entrada: string;
}) {
  const router = useRouter();
  const caminho = usePathname();
  const consulta = useSearchParams().toString();
  const [ocupado, iniciar] = useTransition();

  /**
   * Reescreve a URL, que é onde os filtros moram agora.
   *
   * Toda mudança de filtro volta para a primeira página: manter a página 7 ao
   * trocar o recorte mostraria "nada aqui" numa lista que tem resultado.
   *
   * `useCallback` não é enfeite: a caixa de busca espera a digitação parar
   * antes de consultar, e uma função nova a cada renderização reiniciaria essa
   * espera para sempre — a busca nunca dispararia.
   */
  const aplicar = useCallback((mudancas: Record<string, string>) => {
    const p = new URLSearchParams(consulta);
    for (const [chave, valor] of Object.entries(mudancas)) {
      if (valor) p.set(chave, valor);
      else p.delete(chave);
    }
    if (!('pagina' in mudancas)) p.delete('pagina');
    iniciar(() => {
      // `scroll: false`: trocar de filtro não pode jogar a página para o topo
      // no meio da leitura da tabela.
      router.replace(`${caminho}?${p.toString()}`, { scroll: false });
    });
  }, [consulta, caminho, router]);

  const buscar = useCallback((texto: string) => aplicar({ busca: texto }), [aplicar]);

  const paginas = Math.max(1, Math.ceil(total / porPagina));
  const primeiraDaPagina = total === 0 ? 0 : pagina * porPagina + 1;
  const ultimaDaPagina = Math.min(total, (pagina + 1) * porPagina);

  return (
    <div className={cx('space-y-4 transition-opacity', ocupado && 'opacity-60')}>
      <div className="flex flex-wrap items-center gap-1.5">
        {RECORTES.map((r) => (
          <button key={r.chave} type="button" onClick={() => aplicar({ recorte: r.chave === 'todos' ? '' : r.chave })}
                  className={cx(
                    'rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                    filtros.recorte === r.chave ? 'bg-texto text-fundo' : 'text-suave hover:bg-superficie-alta hover:text-texto',
                  )}>
            {r.rotulo} <span className="tabular-nums opacity-60">{contagens[r.chave].toLocaleString('pt-BR')}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <CampoBusca valor={filtros.busca} aoBuscar={buscar} ocupado={ocupado} />

        <Selecao compacto value={filtros.atendente} onChange={(e) => aplicar({ atendente: e.target.value })}
                 aria-label="Filtrar por atendente">
          <option value="">Todos os atendentes</option>
          {atendentes.map((a) => <option key={a.id} value={a.id}>{a.primeiro_nome}</option>)}
        </Selecao>

        <Selecao compacto value={filtros.lista} onChange={(e) => aplicar({ lista: e.target.value })}
                 aria-label="Filtrar por lista">
          <option value="">Todas as listas</option>
          <option value="sem">Sem lista (cadastro próprio)</option>
          {listas.map((l) => (
            <option key={l.id} value={l.id}>{l.rotulo}{l.ativa ? '' : ' (pausada)'}</option>
          ))}
        </Selecao>

        <Selecao compacto value={filtros.candidato} onChange={(e) => aplicar({ candidato: e.target.value })}
                 aria-label="Filtrar por candidato de origem">
          <option value="">Toda origem de candidato</option>
          {candidatos.map((c) => <option key={c.id} value={c.id}>{c.nome_urna}</option>)}
        </Selecao>

        <Selecao compacto value={filtros.origem} onChange={(e) => aplicar({ origem: e.target.value })}
                 aria-label="Filtrar por origem">
          <option value="">Fria e quente</option>
          <option value="site">Cadastrou no site</option>
          <option value="kit">Pediu o kit</option>
          <option value="chamou">Chamou no WhatsApp</option>
          <option value="lista_fria">Lista fria</option>
        </Selecao>

        <Selecao compacto value={filtros.municipio} onChange={(e) => aplicar({ municipio: e.target.value })}
                 aria-label="Filtrar por cidade">
          <option value="">Todas as cidades</option>
          {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </Selecao>

        <span className="ml-auto text-xs tabular-nums text-suave">
          {total === 0
            ? 'nenhum contato'
            : `${primeiraDaPagina.toLocaleString('pt-BR')}–${ultimaDaPagina.toLocaleString('pt-BR')} de ${total.toLocaleString('pt-BR')}`}
        </span>
      </div>

      {contatos.length === 0 ? (
        <Cartao className="px-6 py-10 text-center text-sm text-suave">
          Nada com esses filtros — e agora isso quer dizer nada na base inteira, não só nesta tela.
        </Cartao>
      ) : (
        <Cartao className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-borda text-left">
                {['Pessoa', 'Origem', 'Situação', 'Atendente', 'Falou em', 'Msgs', 'Cliques', ''].map((h, i) => (
                  <th key={h || i}
                      className={cx('px-4 py-2.5 text-xs font-medium text-suave',
                        i >= 5 && i <= 6 && 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {contatos.map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-superficie-alta/60">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">
                      {c.nome ?? <span className="text-tenue">(dados apagados)</span>}
                    </p>
                    <p className="text-xs text-suave">
                      {c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '—'}
                      {c.municipio && ` · ${c.municipio}`}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <EtiquetaOrigem origem={c.origem} />
                    {c.candidato_origem && (
                      <p className="mt-1 text-xs text-suave">via {c.candidato_origem}</p>
                    )}
                    {/* O mesmo ponto que o atendente vê na etiqueta do contato. */}
                    {c.lista_id && c.lista && (
                      <p className="mt-1 flex items-center gap-1.5 text-xs text-suave">
                        <PontoLista id={c.lista_id} />
                        <span className="max-w-[10rem] truncate">{c.lista}</span>
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Pilula cor={COR_STATUS[c.status]}>{ROTULO_STATUS[c.status]}</Pilula>
                    {c.kit_pendente && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-alerta">
                        <PackageOpen size={11} /> kit a entregar
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-suave">
                    {c.atendente ?? '—'}
                    {c.chip && <span className="block text-xs text-tenue">{c.chip}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-suave">{dataHora(c.primeiro_contato_em)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.mensagens}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.cliques > 0
                      ? <span className="inline-flex items-center gap-1 text-acento">
                          <MousePointerClick size={12} />{c.cliques}
                        </span>
                      : <span className="text-tenue">0</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/${entrada}/painel/contatos/${c.id}`}
                          className="text-xs text-suave underline-offset-4 hover:text-texto hover:underline">
                      abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Cartao>
      )}

      {paginas > 1 && (
        <div className="flex flex-wrap items-center justify-center gap-3">
          <BotaoPagina
            aoClicar={() => aplicar({ pagina: String(pagina - 1) })}
            desabilitado={pagina <= 0 || ocupado}
          >
            <ChevronLeft size={14} /> Anterior
          </BotaoPagina>

          <span className="text-xs tabular-nums text-suave">
            página {(pagina + 1).toLocaleString('pt-BR')} de {paginas.toLocaleString('pt-BR')}
          </span>

          <BotaoPagina
            aoClicar={() => aplicar({ pagina: String(pagina + 1) })}
            desabilitado={pagina + 1 >= paginas || ocupado}
          >
            Próxima <ChevronRight size={14} />
          </BotaoPagina>
        </div>
      )}
    </div>
  );
}

/**
 * A caixa de busca.
 *
 * Digitação com folga antes de consultar: a busca agora vai ao banco, e uma ida
 * por tecla seria uma consulta a cada 80ms enquanto alguém digita um nome. O
 * texto é estado local para o campo não engasgar esperando a resposta.
 */
function CampoBusca({
  valor, aoBuscar, ocupado,
}: {
  valor: string;
  aoBuscar: (texto: string) => void;
  ocupado: boolean;
}) {
  const [texto, setTexto] = useState(valor);

  // O valor que veio do servidor manda quando muda por fora — voltar pelo
  // navegador, ou abrir um link já filtrado. Ajuste durante a renderização, que
  // é o que o React prevê para "estado que depende de outro".
  const [valorAnterior, setValorAnterior] = useState(valor);
  if (valor !== valorAnterior) {
    setValorAnterior(valor);
    setTexto(valor);
  }

  // A comparação é com o que o SERVIDOR já tem: quando a navegação termina,
  // `valor` alcança `texto` e não há nada a reenviar.
  useEffect(() => {
    if (texto === valor) return;
    const t = setTimeout(() => aoBuscar(texto), 350);
    return () => clearTimeout(t);
  }, [texto, valor, aoBuscar]);

  return (
    <label className="relative">
      {ocupado
        ? <Loader2 size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 animate-spin text-suave" />
        : <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-tenue" />}
      <input value={texto} onChange={(e) => setTexto(e.target.value)}
             placeholder="nome ou telefone"
             aria-label="Buscar por nome ou telefone"
             className="w-52 rounded-full border border-borda bg-superficie-alta py-2 pl-9 pr-4 text-sm placeholder:text-tenue" />
    </label>
  );
}

function BotaoPagina({
  children, desabilitado, aoClicar,
}: {
  children: React.ReactNode;
  desabilitado: boolean;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={desabilitado}
      className={cx(
        'flex items-center gap-1.5 rounded-full border border-borda bg-superficie px-4 py-2 text-sm font-medium transition-colors',
        'enabled:hover:border-borda-forte enabled:hover:text-texto',
        'disabled:cursor-not-allowed disabled:opacity-40',
      )}
    >
      {children}
    </button>
  );
}
