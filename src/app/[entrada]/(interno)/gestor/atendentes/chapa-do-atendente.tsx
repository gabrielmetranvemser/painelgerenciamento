'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Plus, Star, X } from 'lucide-react';
import { Aviso, Botao, Cartao, Pilula, Selecao, cx } from '@/components/ui';
import { ROTULO_CARGO, type Candidato, type CargoEleitoral } from '@/lib/tipos-banco';
import { atribuirCandidato, definirPrincipal, removerDaChapa } from './chapa';

export type ItemChapa = {
  candidato_id: string;
  cargo: CargoEleitoral;
  vaga: number;
  principal: boolean;
  nome: string;
  numero: string;
};

export function ChapaDoAtendente({
  atendenteId, chapa, candidatos,
}: {
  atendenteId: string;
  chapa: ItemChapa[];
  candidatos: Candidato[];
}) {
  const [escolhido, setEscolhido] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const jaNaChapa = new Set(chapa.map((c) => c.candidato_id));
  const disponiveis = candidatos.filter((c) => c.ativo && !jaNaChapa.has(c.id));

  return (
    <div className="border-t border-borda bg-fundo/40 px-5 py-4">
      <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
        Chapa deste atendente
      </p>

      {chapa.length === 0 ? (
        <p className="mb-3 text-xs leading-relaxed text-suave">
          Sem candidato. A primeira mensagem sairia sem nome nenhum, então este atendente ainda
          não consegue trabalhar.
        </p>
      ) : (
        <ul className="mb-3 space-y-2">
          {chapa.map((c) => (
            <li key={c.candidato_id}
                className={cx('flex flex-wrap items-center gap-2.5 rounded-xl border px-3.5 py-2.5',
                  c.principal ? 'border-acento/40 bg-acento/[0.07]' : 'border-borda bg-superficie')}>
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-semibold">
                  {c.nome}
                  <span className="ml-2 font-mono text-xs font-normal text-suave">{c.numero}</span>
                </p>
                <p className="text-xs text-suave">
                  {ROTULO_CARGO[c.cargo]}{c.cargo === 'senador' && ` · ${c.vaga}ª vaga`}
                </p>
              </div>

              {c.principal ? (
                <Pilula cor="acento"><Star size={11} /> citado na 1ª mensagem</Pilula>
              ) : (
                <button type="button" disabled={ocupado}
                        className="text-xs text-suave hover:text-texto"
                        onClick={() => iniciar(async () => {
                          const r = await definirPrincipal(atendenteId, c.candidato_id);
                          if (r.ok) router.refresh(); else setErro(r.erro);
                        })}>
                  tornar principal
                </button>
              )}

              <button type="button" disabled={ocupado} title="Tirar da chapa"
                      className="text-suave hover:text-perigo"
                      onClick={() => iniciar(async () => {
                        await removerDaChapa(atendenteId, c.candidato_id);
                        setErro(null); router.refresh();
                      })}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {erro && <Aviso tom="erro" className="mb-3">{erro}</Aviso>}

      {disponiveis.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Selecao compacto value={escolhido} onChange={(e) => setEscolhido(e.target.value)}
                   aria-label="Candidato a acrescentar">
            <option value="">Acrescentar candidato…</option>
            {disponiveis.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome_urna} — {ROTULO_CARGO[c.cargo]}
                {c.cargo === 'senador' ? ` (${c.vaga}ª vaga)` : ''} · {c.numero}
              </option>
            ))}
          </Selecao>
          <Botao tamanho="p" disabled={!escolhido || ocupado}
                 onClick={() => iniciar(async () => {
                   const r = await atribuirCandidato(atendenteId, escolhido);
                   if (r.ok) { setEscolhido(''); setErro(null); router.refresh(); } else setErro(r.erro);
                 })}>
            <Plus size={13} /> Acrescentar
          </Botao>
        </div>
      ) : (
        <p className="text-xs text-suave">
          {candidatos.length === 0
            ? 'Cadastre candidatos antes de montar a chapa.'
            : 'Todos os candidatos ativos já estão nesta chapa.'}
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed text-suave">
        Um candidato por cargo — dois no caso de senador, que tem duas vagas. É o que impede a
        mesma pessoa de receber material de dois concorrentes ao mesmo cargo. O principal é o
        citado na primeira mensagem; os outros se apresentam no material de cada um.
      </p>
    </div>
  );
}

export function CartaoChapa({ children }: { children: React.ReactNode }) {
  return <Cartao className="overflow-hidden">{children}</Cartao>;
}
