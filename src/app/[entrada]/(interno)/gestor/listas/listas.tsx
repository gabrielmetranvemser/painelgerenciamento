'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Pause, Pencil, Play, Plus, Trash2, Users, X } from 'lucide-react';
import { Aviso, Botao, Cartao, EtiquetaOrigem, Pilula, PontoLista, Selecao, cx } from '@/components/ui';
import type { ListaComContagem, Usuario } from '@/lib/tipos-banco';
import {
  alternarAtendenteNaLista, alternarListaAtiva, apagarLista, atribuirListaATodos, renomearLista,
} from './acoes';

export function Listas({
  listas, atendentes, porLista,
}: {
  listas: ListaComContagem[];
  atendentes: Usuario[];
  porLista: Record<string, string[]>;
}) {
  return (
    <div className="space-y-4">
      {listas.map((l) => (
        <CartaoLista
          key={l.id}
          lista={l}
          atendentes={atendentes}
          atribuidos={porLista[l.id] ?? []}
        />
      ))}
    </div>
  );
}

function CartaoLista({
  lista, atendentes, atribuidos,
}: {
  lista: ListaComContagem;
  atendentes: Usuario[];
  atribuidos: string[];
}) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(lista.rotulo);
  const [escolhido, setEscolhido] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  /**
   * Quantos contatos vão junto se apagar. `null` = ainda não perguntei.
   *
   * Duas voltas de propósito: a primeira chamada ao servidor só CONTA, e é ela
   * que dá o número para a pergunta. Perguntar "tem certeza?" sem dizer quantas
   * pessoas somem é pedir uma confirmação que ninguém tem como avaliar.
   */
  const [confirmandoApagar, setConfirmandoApagar] = useState<number | null>(null);

  function apagar(confirmar: boolean) {
    iniciar(async () => {
      const r = await apagarLista(lista.id, confirmar);
      if (r.ok) { setErro(null); router.refresh(); return; }

      if (r.motivo === 'precisa_confirmar') { setErro(null); setConfirmandoApagar(r.total); return; }
      setConfirmandoApagar(null);

      if (r.motivo === 'tem_historico') {
        setErro(
          `Não dá para apagar: ${r.abordados} ${r.abordados === 1 ? 'pessoa desta lista já foi abordada' : 'pessoas desta lista já foram abordadas'}. ` +
          'O histórico da conversa e a procedência do contato ficam nela — apagar seria apagar a ' +
          'defesa da campanha sobre gente com quem a gente realmente falou. Use Pausar: sai da ' +
          'fila na hora e não perde nada.',
        );
        return;
      }
      if (r.motivo === 'contato_em_atendimento') {
        setErro(
          `${r.naMao} contato(s) desta lista ${r.naMao === 1 ? 'está' : 'estão'} na mão de um atendente agora. ` +
          'Espere a reserva vencer (ou peça para ele soltar) e tente de novo.',
        );
        return;
      }
      setErro(r.motivo === 'lista_nao_existe'
        ? 'Essa lista já não existe. Atualize a página.'
        : ('erro' in r && r.erro) || 'Só o gestor apaga listas.');
    });
  }

  const dentro = new Set(atribuidos);
  const naLista = atendentes.filter((a) => dentro.has(a.id));
  const disponiveis = atendentes.filter((a) => !dentro.has(a.id));

  function agir(acao: () => Promise<{ ok: true } | { ok: false; erro: string }>) {
    iniciar(async () => {
      const r = await acao();
      if (r.ok) { setErro(null); router.refresh(); } else setErro(r.erro);
    });
  }

  return (
    <Cartao className={cx('overflow-hidden', !lista.ativa && 'opacity-70')}>
      <div className="flex flex-wrap items-center gap-3 px-5 py-4">
        {editando ? (
          <form
            className="mr-auto flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              agir(async () => {
                const r = await renomearLista(lista.id, nome);
                if (r.ok) setEditando(false);
                return r;
              });
            }}
          >
            <input
              autoFocus
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              onKeyDown={(e) => {
                // Esc desfaz. Sem isto, quem abriu a edição por engano fica
                // preso escolhendo entre salvar um nome errado e recarregar.
                if (e.key !== 'Escape') return;
                setNome(lista.rotulo);
                setEditando(false);
              }}
              aria-label="Nome da lista"
              className="w-64 max-w-full rounded-xl border border-borda-forte bg-superficie-alta px-3 py-1.5 text-sm font-semibold text-texto"
            />
            <Botao type="submit" tamanho="p" disabled={ocupado}><Check size={13} /> Salvar</Botao>
          </form>
        ) : (
          <div className="mr-auto flex min-w-0 items-center gap-2">
            {/* O mesmo ponto que o atendente vê na etiqueta do contato: é assim
                que o gestor sabe de qual lista ele está falando ao telefone. */}
            <PontoLista id={lista.id} />
            <p className="truncate font-display text-lg font-semibold tracking-tight">
              {lista.rotulo}
            </p>
            <button
              type="button"
              title="Renomear"
              onClick={() => setEditando(true)}
              className="shrink-0 text-suave transition-colors hover:text-texto"
            >
              <Pencil size={13} />
            </button>
          </div>
        )}

        <EtiquetaOrigem origem={lista.origem} />
        {!lista.ativa && <Pilula cor="alerta"><Pause size={11} /> pausada</Pilula>}

        <Botao
          variante={lista.ativa ? 'neutro' : 'principal'}
          tamanho="p"
          disabled={ocupado}
          onClick={() => agir(() => alternarListaAtiva(lista.id, !lista.ativa))}
        >
          {lista.ativa ? <><Pause size={12} /> Pausar</> : <><Play size={12} /> Reativar</>}
        </Botao>

        {/* Apagar fica ao lado de Pausar porque é a mesma pergunta feita duas
            vezes — "tirar da frente" e "tirar de vez". Separá-los faria o
            gestor procurar o segundo depois de já ter usado o primeiro. */}
        {confirmandoApagar === null ? (
          <Botao variante="fantasma" tamanho="p" disabled={ocupado}
                 title="Apaga a lista. Os contatos que ninguém abordou vão junto."
                 onClick={() => apagar(false)}>
            <Trash2 size={12} /> Apagar
          </Botao>
        ) : (
          <>
            <Botao variante="perigo" tamanho="p" disabled={ocupado}
                   onClick={() => apagar(true)}>
              {ocupado
                ? 'Apagando…'
                : confirmandoApagar === 0
                  ? 'Confirmar: apagar a lista'
                  : `Confirmar: apagar a lista e ${confirmandoApagar.toLocaleString('pt-BR')} contato(s)`}
            </Botao>
            <Botao variante="fantasma" tamanho="p"
                   onClick={() => setConfirmandoApagar(null)}>
              Cancelar
            </Botao>
          </>
        )}
      </div>

      {confirmandoApagar !== null && confirmandoApagar > 0 && (
        <Aviso tom="alerta" className="mx-5 mb-4">
          Os {confirmandoApagar.toLocaleString('pt-BR')} contatos desta lista somem da base junto
          com ela, e não tem como desfazer. Ninguém foi abordado, então nada de histórico se
          perde — mas se você só quer tirar da fila, <strong>Pausar</strong> faz isso e mantém
          tudo.
        </Aviso>
      )}

      <div className="flex flex-wrap items-baseline gap-x-5 gap-y-1 border-t border-borda px-5 py-3 text-xs text-suave">
        <span>
          <strong className="font-display text-sm text-texto">
            {lista.contatos_total.toLocaleString('pt-BR')}
          </strong>{' '}
          contatos
        </span>
        <span>
          <strong className="font-display text-sm text-texto">
            {lista.contatos_na_fila.toLocaleString('pt-BR')}
          </strong>{' '}
          ainda na fila
        </span>
        <span>
          <strong className="font-display text-sm text-texto">
            {lista.contatos_falados.toLocaleString('pt-BR')}
          </strong>{' '}
          já abordados
        </span>
        {lista.entregue_por && (
          <span className="ml-auto">
            entregue por {lista.entregue_por}
            {lista.entregue_em && ` em ${new Date(`${lista.entregue_em}T12:00:00`).toLocaleDateString('pt-BR')}`}
          </span>
        )}
      </div>

      <div className="border-t border-borda bg-fundo/40 px-5 py-4">
        <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
          <Users size={12} /> Quem atende esta lista
        </p>

        {naLista.length === 0 ? (
          <p className="mb-3 text-xs leading-relaxed text-suave">
            Ninguém. Estes contatos não vão para a fila de pessoa nenhuma enquanto isso — ficam
            guardados, sem serem chamados.
          </p>
        ) : (
          <ul className="mb-3 flex flex-wrap gap-2">
            {naLista.map((a) => (
              <li key={a.id}
                  className="flex items-center gap-2 rounded-full border border-borda bg-superficie px-3 py-1.5 text-xs font-semibold">
                {a.primeiro_nome}
                <button
                  type="button"
                  title={`Tirar ${a.primeiro_nome} desta lista`}
                  disabled={ocupado}
                  className="text-suave transition-colors hover:text-perigo"
                  onClick={() => agir(() => alternarAtendenteNaLista(lista.id, a.id, false))}
                >
                  <X size={12} />
                </button>
              </li>
            ))}
          </ul>
        )}

        {erro && <Aviso tom="erro" className="mb-3">{erro}</Aviso>}

        {disponiveis.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2">
            <Selecao compacto value={escolhido} onChange={(e) => setEscolhido(e.target.value)}
                     aria-label="Atendente a acrescentar">
              <option value="">Acrescentar atendente…</option>
              {disponiveis.map((a) => (
                <option key={a.id} value={a.id}>{a.primeiro_nome}</option>
              ))}
            </Selecao>
            <Botao tamanho="p" disabled={!escolhido || ocupado}
                   onClick={() => agir(async () => {
                     const r = await alternarAtendenteNaLista(lista.id, escolhido, true);
                     if (r.ok) setEscolhido('');
                     return r;
                   })}>
              <Plus size={13} /> Acrescentar
            </Botao>
            <Botao variante="fantasma" tamanho="p" disabled={ocupado}
                   onClick={() => agir(() => atribuirListaATodos(lista.id))}>
              marcar para todos
            </Botao>
          </div>
        ) : (
          <p className="text-xs text-suave">
            {atendentes.length === 0
              ? 'Não há atendente ativo cadastrado.'
              : 'Todos os atendentes ativos já estão nesta lista.'}
          </p>
        )}
      </div>
    </Cartao>
  );
}
