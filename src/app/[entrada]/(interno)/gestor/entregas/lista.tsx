'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Check, Loader2, MapPin, Phone, Undo2, X } from 'lucide-react';
import { Aviso, Botao, Cartao, Pilula, Selecao, cx } from '@/components/ui';
import { formatarExibicao } from '@/lib/telefone';
import { rotuloDoItem, type ItemKit } from '@/lib/itens-kit';
import type { Entrega } from '@/lib/tipos-banco';
import { marcarEntrega, type EstadoEntrega } from './acoes';

const ABAS: { chave: EstadoEntrega; rotulo: string }[] = [
  { chave: 'pendente', rotulo: 'A entregar' },
  { chave: 'entregue', rotulo: 'Entregues' },
  { chave: 'cancelado', rotulo: 'Cancelados' },
];

/** A pessoa saiu da lista depois de pedir o material. */
function saiuDaLista(e: Entrega) {
  return e.status_contato === 'pediu_saida' || e.nome === null;
}

export function ListaEntregas({
  entregas, itensKit,
}: {
  entregas: Entrega[];
  /**
   * O cadastro de itens, só para traduzir a chave em rótulo.
   *
   * ⚠️ Inclui os DESATIVADOS de propósito: quem pediu um item que saiu do
   * cadastro continua na fila de entrega, e a chave crua no meio de rótulos em
   * português seria a linha que o entregador não entende.
   */
  itensKit: readonly ItemKit[];
}) {
  const [aba, setAba] = useState<EstadoEntrega>('pendente');
  const [cidade, setCidade] = useState('');
  const [busca, setBusca] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const cidades = useMemo(
    () => [...new Set(entregas.map((e) => e.municipio).filter(Boolean) as string[])].sort(),
    [entregas],
  );

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    return entregas.filter((e) =>
      e.estado === aba &&
      (!cidade || e.municipio === cidade) &&
      (!t ||
        (e.nome ?? '').toLowerCase().includes(t) ||
        (e.telefone_e164 ?? '').includes(t.replace(/\D/g, '')) ||
        // Busca por bairro é como a equipe de entrega separa a rota do dia.
        (e.bairro ?? '').toLowerCase().includes(t) ||
        (e.endereco ?? '').toLowerCase().includes(t)),
    );
  }, [entregas, aba, cidade, busca]);

  function mudar(id: string, estado: EstadoEntrega) {
    setErro(null);
    iniciar(async () => {
      const r = await marcarEntrega(id, estado);
      if (!r.ok) { setErro(r.motivo === 'restrito_ao_gestor' ? 'Só o gestor pode marcar entrega.' : `Não consegui gravar: ${r.motivo}`); return; }
      router.refresh();
    });
  }

  const contagem = (chave: EstadoEntrega) => entregas.filter((e) => e.estado === chave).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        {ABAS.map((a) => (
          <button key={a.chave} type="button" onClick={() => setAba(a.chave)}
                  className={cx(
                    'rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                    aba === a.chave ? 'bg-texto text-fundo' : 'text-suave hover:bg-superficie-alta hover:text-texto',
                  )}>
            {a.rotulo} <span className="tabular-nums opacity-60">{contagem(a.chave)}</span>
          </button>
        ))}

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <input
            value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="nome, telefone ou endereço"
            className="w-56 rounded-full border border-borda bg-superficie-alta px-4 py-2 text-sm placeholder:text-tenue"
          />
          <Selecao compacto value={cidade} onChange={(e) => setCidade(e.target.value)}
                   aria-label="Filtrar por cidade">
            <option value="">Todas as cidades</option>
            {cidades.map((c) => <option key={c} value={c}>{c}</option>)}
          </Selecao>
        </div>
      </div>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {visiveis.length === 0 ? (
        <Cartao className="px-6 py-10 text-center text-sm text-suave">
          Nada aqui com esses filtros.
        </Cartao>
      ) : (
        <div className="space-y-2.5">
          {visiveis.map((e) => (
            <Cartao key={e.id} className="p-4">
              <div className="flex flex-wrap items-start gap-3">
                <div className="mr-auto min-w-0">
                  <p className="flex flex-wrap items-center gap-2 font-semibold">
                    {e.nome ?? <span className="text-tenue">(dados apagados)</span>}
                    {e.candidato && <Pilula>{e.candidato}</Pilula>}
                    {saiuDaLista(e) && <Pilula cor="perigo">pediu saída — não entregar</Pilula>}
                  </p>

                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-suave">
                    {e.telefone_e164 && (
                      <span className="inline-flex items-center gap-1.5">
                        <Phone size={11} /> {formatarExibicao(e.telefone_e164)}
                      </span>
                    )}
                    {e.municipio && (
                      <span className="inline-flex items-center gap-1.5">
                        <MapPin size={11} /> {[e.bairro, e.municipio].filter(Boolean).join(', ')}
                      </span>
                    )}
                    <span>pedido em {new Date(e.pedido_em).toLocaleDateString('pt-BR')}</span>
                    {e.atendente && <span>atendido por {e.atendente}</span>}
                  </p>

                  {e.endereco && (
                    <p className="mt-2 whitespace-pre-line rounded-xl border border-borda bg-superficie-alta px-3.5 py-2.5 text-sm leading-relaxed">
                      {e.endereco}
                    </p>
                  )}

                  <p className="mt-2 flex flex-wrap gap-1.5">
                    {(e.itens ?? []).map((i) => (
                      <Pilula key={i} cor="acento">{rotuloDoItem(i, itensKit)}</Pilula>
                    ))}
                    {e.tamanho_camiseta && <Pilula>tamanho {e.tamanho_camiseta}</Pilula>}
                  </p>

                  {e.estado === 'entregue' && e.entregue_em && (
                    <p className="mt-2 text-xs text-ok">
                      entregue em {new Date(e.entregue_em).toLocaleString('pt-BR')}
                      {e.entregue_por && ` por ${e.entregue_por}`}
                    </p>
                  )}
                  {e.estado === 'cancelado' && e.cancelado_em && (
                    <p className="mt-2 text-xs text-suave">
                      cancelado em {new Date(e.cancelado_em).toLocaleString('pt-BR')}
                      {e.cancelado_por && ` por ${e.cancelado_por}`}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap gap-2">
                  {e.estado === 'pendente' ? (
                    <>
                      <Botao tamanho="p" disabled={ocupado} onClick={() => mudar(e.id, 'entregue')}>
                        {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
                        Entreguei
                      </Botao>
                      <Botao variante="neutro" tamanho="p" disabled={ocupado}
                             onClick={() => mudar(e.id, 'cancelado')}>
                        <X size={13} /> Cancelar
                      </Botao>
                    </>
                  ) : (
                    <Botao variante="neutro" tamanho="p" disabled={ocupado}
                           onClick={() => mudar(e.id, 'pendente')}>
                      <Undo2 size={13} /> Voltar para a fila
                    </Botao>
                  )}
                </div>
              </div>
            </Cartao>
          ))}
        </div>
      )}
    </div>
  );
}
