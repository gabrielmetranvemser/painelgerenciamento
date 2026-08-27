'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Pause, Plus } from 'lucide-react';
import { Aviso, cx } from '@/components/ui';
import type { Lista } from '@/lib/tipos-banco';
import { alternarAtendenteNaLista } from '../listas/acoes';

export type ItemLista = Pick<Lista, 'id' | 'rotulo' | 'origem' | 'ativa'>;

/**
 * As listas de contato deste atendente.
 *
 * Botão que liga e desliga, e não caixinha com "salvar": o gestor mexe nisso
 * enquanto conversa com a equipe, e um formulário com botão de gravar é um
 * formulário que alguém deixa aberto sem salvar.
 *
 * Lista pausada aparece só se este atendente já estiver nela — para explicar
 * por que a fila dele não anda. Pausada não entrega contato para ninguém.
 */
export function ListasDoAtendente({
  atendenteId, listas, marcadas,
}: {
  atendenteId: string;
  listas: ItemLista[];
  marcadas: string[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const dentro = new Set(marcadas);
  const visiveis = listas.filter((l) => l.ativa || dentro.has(l.id));
  const nenhuma = visiveis.every((l) => !dentro.has(l.id));

  return (
    <div className="border-t border-borda bg-fundo/40 px-5 py-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
        Listas de contato deste atendente
      </p>

      {visiveis.length === 0 ? (
        <p className="text-xs leading-relaxed text-suave">
          Nenhuma lista importada ainda. Suba a primeira planilha em Base → Importar.
        </p>
      ) : (
        <>
          <ul className="flex flex-wrap gap-2">
            {visiveis.map((l) => {
              const marcada = dentro.has(l.id);
              return (
                <li key={l.id}>
                  <button
                    type="button"
                    disabled={ocupado}
                    aria-pressed={marcada}
                    onClick={() => iniciar(async () => {
                      const r = await alternarAtendenteNaLista(l.id, atendenteId, !marcada);
                      if (r.ok) { setErro(null); router.refresh(); } else setErro(r.erro);
                    })}
                    className={cx(
                      'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                      marcada
                        ? 'border-acento/40 bg-acento/12 text-acento'
                        : 'border-borda bg-superficie text-suave hover:border-borda-forte hover:text-texto',
                    )}
                  >
                    {marcada ? <Check size={12} /> : <Plus size={12} />}
                    <span className="max-w-[16rem] truncate">{l.rotulo}</span>
                    {!l.ativa && <Pause size={11} className="text-alerta" />}
                  </button>
                </li>
              );
            })}
          </ul>

          {erro && <Aviso tom="erro" className="mt-3">{erro}</Aviso>}

          <p className="mt-3 text-xs leading-relaxed text-suave">
            {nenhuma
              ? 'Sem nenhuma lista marcada, esta pessoa só recebe quem se cadastrou sozinho pelo site — na prática, fila parada.'
              : 'A mesma lista pode estar com mais de um atendente: aí ela é dividida entre eles, um contato de cada vez. Quem se cadastrou sozinho pelo site cai para todo mundo, com lista ou sem.'}
          </p>
        </>
      )}
    </div>
  );
}
