'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import {
  Check, ChevronDown, FolderPlus, Layers, Pause, Pencil, Play, Plus, Trash2, Users, X,
} from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, EtiquetaOrigem, Pilula, PontoLista, Selecao, cx } from '@/components/ui';
import type { GrupoDeLista, ListaComContagem, Usuario } from '@/lib/tipos-banco';
import {
  alternarAtendenteNaLista, alternarGrupo, alternarListaAtiva, apagarGrupo, apagarLista,
  atribuirListaATodos, criarGrupo, moverListaParaGrupo, renomearGrupo, renomearLista,
} from './acoes';

/**
 * As listas, em BLOCOS por grupo.
 *
 * ⚠️ Depois da reimportação de 31/08 esta tela tinha quase quarenta linhas
 * iguais — as novas e as antigas misturadas — e não havia como olhar para ela e
 * entender o que estava no ar. O grupo dá o corte que faltava, e o interruptor
 * do bloco desliga um conjunto inteiro sem apagar nada.
 *
 * "Sem grupo" fica por ÚLTIMO e só aparece quando existe alguma. É o resto, não
 * um grupo — pô-lo no topo faria a lista recém-importada, que ainda não foi
 * organizada, parecer a mais importante da tela.
 */
export function Listas({
  listas, grupos, atendentes, porLista,
}: {
  listas: ListaComContagem[];
  grupos: GrupoDeLista[];
  atendentes: Usuario[];
  porLista: Record<string, string[]>;
}) {
  const soltas = listas.filter((l) => !l.grupo_id);

  return (
    <div className="space-y-5">
      <NovoGrupo />

      {grupos.map((g) => (
        <BlocoGrupo
          key={g.id} grupo={g} grupos={grupos}
          listas={listas.filter((l) => l.grupo_id === g.id)}
          atendentes={atendentes} porLista={porLista}
        />
      ))}

      {soltas.length > 0 && (
        <section>
          {grupos.length > 0 && (
            <p className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
              <Layers size={13} /> Sem grupo
            </p>
          )}
          <div className="space-y-3">
            {soltas.map((l) => (
              <CartaoLista key={l.id} lista={l} grupos={grupos}
                           atendentes={atendentes} atribuidos={porLista[l.id] ?? []} />
            ))}
          </div>
        </section>
      )}
    </div>
  );
}

function NovoGrupo() {
  const [aberto, setAberto] = useState(false);
  const [nome, setNome] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
              className="flex items-center gap-1.5 text-xs font-semibold text-acento">
        <FolderPlus size={14} /> Novo grupo
      </button>
    );
  }

  return (
    <Cartao className="p-4">
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-48 flex-1">
          <Campo rotulo="Nome do grupo" value={nome} autoFocus
                 placeholder="Ex.: Listas de setembro"
                 onChange={(e) => { setNome(e.target.value); setErro(null); }} />
        </div>
        <Botao disabled={!nome.trim() || ocupado}
               onClick={() => iniciar(async () => {
                 const r = await criarGrupo(nome);
                 if (r.ok) { setNome(''); setAberto(false); setErro(null); router.refresh(); }
                 else setErro(r.erro);
               })}>
          Criar
        </Botao>
        <Botao variante="fantasma" onClick={() => { setAberto(false); setNome(''); setErro(null); }}>
          Cancelar
        </Botao>
      </div>
      {erro && <Aviso tom="erro" className="mt-3">{erro}</Aviso>}
    </Cartao>
  );
}

/**
 * Um grupo, com o interruptor que desliga o bloco inteiro.
 *
 * O cabeçalho diz quantas listas e quantos contatos estão na fila POR ELE —
 * porque é esse o número que muda quando se desliga, e é ele que o gestor
 * precisa ver antes de clicar.
 */
function BlocoGrupo({
  grupo, grupos, listas, atendentes, porLista,
}: {
  grupo: GrupoDeLista;
  grupos: GrupoDeLista[];
  listas: ListaComContagem[];
  atendentes: Usuario[];
  porLista: Record<string, string[]>;
}) {
  /**
   * Nasce FECHADO, e é esse o pedido: "na aba de listas fica mais organizado do
   * que várias linhas de listas — fica os blocos de grupos".
   *
   * Aberto por padrão, a tela volta a ser as quarenta linhas de antes, só que
   * com um cabeçalho no meio. Fechado, cada grupo é uma linha que já diz o que
   * importa: quantas listas e quantos contatos estão na fila por ele.
   */
  const [aberto, setAberto] = useState(false);
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(grupo.nome);
  const [confirmandoApagar, setConfirmandoApagar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const naFila = listas.reduce((n, l) => n + (l.ativa ? l.contatos_na_fila : 0), 0);

  function agir(acao: () => Promise<{ ok: true } | { ok: false; erro: string }>) {
    iniciar(async () => {
      const r = await acao();
      if (r.ok) { setErro(null); router.refresh(); } else setErro(r.erro);
    });
  }

  return (
    <section className={cx(
      'rounded-bloco border p-4',
      grupo.ativo ? 'border-borda bg-superficie/40' : 'border-alerta/35 bg-alerta/[0.04]',
    )}>
      <div className="flex flex-wrap items-center gap-3">
        <button type="button" onClick={() => setAberto((v) => !v)} aria-expanded={aberto}
                className="grid size-6 shrink-0 place-items-center rounded-lg text-suave transition-colors hover:bg-superficie-alta hover:text-texto">
          <ChevronDown size={15} className={cx('transition-transform', !aberto && '-rotate-90')} />
        </button>

        {editando ? (
          <div className="flex flex-1 items-center gap-2">
            <input value={nome} autoFocus onChange={(e) => setNome(e.target.value)}
                   className="min-w-0 flex-1 rounded-lg border border-borda bg-superficie px-2.5 py-1.5 text-sm" />
            <button className="text-acento" disabled={ocupado}
                    onClick={() => { agir(() => renomearGrupo(grupo.id, nome)); setEditando(false); }}>
              <Check size={15} />
            </button>
            <button className="text-suave" onClick={() => { setNome(grupo.nome); setEditando(false); }}>
              <X size={15} />
            </button>
          </div>
        ) : (
          <div className="mr-auto flex min-w-0 items-center gap-2">
            <h2 className="font-display text-lg font-semibold tracking-tight">{grupo.nome}</h2>
            <button onClick={() => setEditando(true)} className="text-suave hover:text-texto">
              <Pencil size={12} />
            </button>
            {!grupo.ativo && <Pilula cor="alerta"><Pause size={11} /> desligado</Pilula>}
          </div>
        )}

        <span className="text-xs text-suave">
          {listas.length} {listas.length === 1 ? 'lista' : 'listas'}
          {grupo.ativo && ` · ${naFila.toLocaleString('pt-BR')} na fila`}
        </span>

        <Botao variante={grupo.ativo ? 'neutro' : 'principal'} tamanho="p" disabled={ocupado}
               onClick={() => agir(() => alternarGrupo(grupo.id, !grupo.ativo))}>
          {grupo.ativo
            ? <><Pause size={12} /> Desligar o grupo</>
            : <><Play size={12} /> Ligar o grupo</>}
        </Botao>

        {confirmandoApagar ? (
          <>
            <Botao variante="perigo" tamanho="p" disabled={ocupado}
                   onClick={() => { setConfirmandoApagar(false); agir(() => apagarGrupo(grupo.id)); }}>
              Confirmar: apagar o grupo
            </Botao>
            <Botao variante="fantasma" tamanho="p" onClick={() => setConfirmandoApagar(false)}>
              Cancelar
            </Botao>
          </>
        ) : (
          <Botao variante="fantasma" tamanho="p"
                 title="Apaga só o grupo. As listas ficam, e as que ele tinha desligado voltam ao ar."
                 onClick={() => setConfirmandoApagar(true)}>
            <Trash2 size={12} />
          </Botao>
        )}
      </div>

      {!grupo.ativo && aberto && (
        <p className="mt-2 pl-9 text-xs leading-relaxed text-alerta">
          As listas deste grupo não entregam contato para ninguém. Nada foi apagado — ligar o
          grupo devolve ao ar exatamente as que ele desligou.
        </p>
      )}

      {erro && <Aviso tom="erro" className="mt-3">{erro}</Aviso>}

      {aberto && (
        <div className="mt-4 space-y-3">
          {listas.length === 0 ? (
            <p className="text-xs text-suave">
              Nenhuma lista aqui ainda. Use o campo &ldquo;Grupo&rdquo; de cada lista para
              trazê-la.
            </p>
          ) : listas.map((l) => (
            <CartaoLista key={l.id} lista={l} grupos={grupos}
                         atendentes={atendentes} atribuidos={porLista[l.id] ?? []} />
          ))}
        </div>
      )}
    </section>
  );
}

function CartaoLista({
  lista, grupos, atendentes, atribuidos,
}: {
  lista: ListaComContagem;
  grupos: GrupoDeLista[];
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
        {/* "pelo grupo" e "pausada" são coisas diferentes para quem lê: a
            primeira volta sozinha quando o grupo religar, a segunda não. */}
        {!lista.ativa && (
          <Pilula cor="alerta">
            <Pause size={11} /> {lista.pausada_pelo_grupo ? 'pelo grupo' : 'pausada'}
          </Pilula>
        )}

        {grupos.length > 0 && (
          <Selecao compacto value={lista.grupo_id ?? ''} disabled={ocupado}
                   title="Grupo desta lista"
                   onChange={(e) => agir(() => moverListaParaGrupo(lista.id, e.target.value || null))}>
            <option value="">sem grupo</option>
            {grupos.map((g) => (
              <option key={g.id} value={g.id}>{g.nome}{g.ativo ? '' : ' (desligado)'}</option>
            ))}
          </Selecao>
        )}

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
