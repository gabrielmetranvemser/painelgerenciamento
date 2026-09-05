'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Copy, Laptop, Lock, Plus, Unlock, X } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, Pilula, Selecao, cx } from '@/components/ui';
import {
  alternarTravaAparelho, gerarConviteAparelho, revogarAparelho,
} from './aparelhos-acoes';

export type AparelhoNaTela = {
  id: string;
  rotulo: string;
  usuario_id: string;
  liberado_em: string | null;
  expira_em: string | null;
  ultimo_uso_em: string | null;
  revogado_em: string | null;
};

/**
 * Quem pode enxergar o painel, e de onde.
 *
 * ⚠️ Com a trava ligada, todo caminho interno devolve 404 para quem não tem a
 * marca do aparelho — inclusive a tela de entrar. Quem receber o endereço por
 * acaso não descobre que existe painel aqui.
 *
 * ⚠️ E isto é OBSCURIDADE, não segurança (CLAUDE.md §7). Quem tiver o cookie E
 * a senha entra. A tela diz isso em voz alta de propósito: um gestor que
 * acredite que esta camada é a tranca vai relaxar na senha, que é onde a
 * tranca realmente está.
 */
export function AparelhosLiberados({
  ligada, aparelhos, equipe, origem,
}: {
  ligada: boolean;
  aparelhos: AparelhoNaTela[];
  equipe: { id: string; primeiro_nome: string }[];
  /** O endereço público do painel, para montar o link do convite. */
  origem: string;
}) {
  const [pessoa, setPessoa] = useState(equipe[0]?.id ?? '');
  const [rotulo, setRotulo] = useState('');
  const [link, setLink] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const liberados = aparelhos.filter((a) => a.liberado_em && !a.revogado_em);
  const convites = aparelhos.filter((a) => !a.liberado_em && !a.revogado_em);

  function nomeDe(id: string) {
    return equipe.find((p) => p.id === id)?.primeiro_nome ?? '—';
  }

  return (
    <Cartao className="p-6">
      <h2 className="flex items-center gap-2 font-semibold">
        <Laptop size={16} className="text-suave" /> Aparelhos que enxergam o painel
      </h2>
      <p className="mb-4 mt-0.5 text-xs leading-relaxed text-suave">
        Com a trava ligada, quem abrir o endereço do painel num aparelho não liberado vê
        <strong className="text-texto"> página não encontrada</strong> — nem a tela de entrar.
        Quem recebeu o link por acaso não descobre que existe painel aqui.
      </p>

      <Aviso tom="alerta" className="mb-4">
        Isto <strong>esconde</strong>, não tranca. Quem tiver o aparelho liberado <em>e</em> a
        senha entra do mesmo jeito — a tranca continua sendo a senha de cada um.
      </Aviso>

      {/* ── o interruptor ─────────────────────────────────────────────── */}
      <div className={cx(
        'mb-5 flex flex-wrap items-center gap-3 rounded-2xl border p-4',
        ligada ? 'border-ok/30 bg-ok/10' : 'border-borda bg-superficie-alta',
      )}>
        {ligada ? <Lock size={16} className="text-ok" /> : <Unlock size={16} className="text-suave" />}
        <div className="mr-auto min-w-0">
          <p className="text-sm font-semibold">{ligada ? 'Trava ligada' : 'Trava desligada'}</p>
          <p className="text-xs text-suave">
            {ligada
              ? `${liberados.length} aparelho(s) enxergam o painel. O resto vê 404.`
              : 'Qualquer um com o endereço chega na tela de entrar, como sempre foi.'}
          </p>
        </div>
        <Botao tamanho="p" variante={ligada ? 'perigo' : 'principal'} disabled={ocupado}
               onClick={() => iniciar(async () => {
                 const r = await alternarTravaAparelho(!ligada);
                 if (r.ok) { setErro(null); router.refresh(); } else setErro(r.erro);
               })}>
          {ligada ? 'Desligar' : 'Ligar a trava'}
        </Botao>
      </div>

      {erro && <Aviso tom="erro" className="mb-4">{erro}</Aviso>}

      {/* ── liberar um aparelho ───────────────────────────────────────── */}
      <div className="mb-5 rounded-2xl border border-borda p-4">
        <p className="mb-3 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
          Liberar um aparelho
        </p>
        <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
          <Selecao rotulo="De quem" value={pessoa} onChange={(e) => setPessoa(e.target.value)}>
            {equipe.map((p) => <option key={p.id} value={p.id}>{p.primeiro_nome}</option>)}
          </Selecao>
          <Campo rotulo="Qual aparelho" value={rotulo} placeholder="Notebook da Laura"
                 onChange={(e) => setRotulo(e.target.value)} />
          <Botao disabled={ocupado || !pessoa || rotulo.trim().length < 2}
                 onClick={() => iniciar(async () => {
                   const r = await gerarConviteAparelho(pessoa, rotulo, origem);
                   if (r.ok) {
                     setLink(r.link); setCopiado(false); setRotulo(''); setErro(null); router.refresh();
                   } else setErro(r.erro);
                 })}>
            <Plus size={13} /> Gerar link
          </Botao>
        </div>

        {link && (
          <div className="mt-4 rounded-xl border border-acento/30 bg-acento/10 p-3.5">
            <p className="mb-2 text-xs font-semibold text-acento">
              Mande este link para a pessoa. Ela abre NO APARELHO dela, uma vez.
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <code className="min-w-0 flex-1 truncate rounded-lg bg-superficie px-3 py-2 font-mono text-xs">
                {link}
              </code>
              <Botao tamanho="p" variante="neutro"
                     onClick={() => { navigator.clipboard.writeText(link); setCopiado(true); }}>
                <Copy size={13} /> {copiado ? 'copiado' : 'copiar'}
              </Botao>
            </div>
            {/* O código não é guardado em claro em lugar nenhum — nem no banco. */}
            <p className="mt-2 text-[11px] leading-relaxed text-suave">
              Vale 48 horas e serve uma vez só. Ele não aparece de novo em lugar nenhum —
              se perder, é só gerar outro.
            </p>
          </div>
        )}
      </div>

      {/* ── a lista ───────────────────────────────────────────────────── */}
      {convites.length > 0 && (
        <>
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
            Esperando a pessoa abrir
          </p>
          <ul className="mb-4 space-y-2">
            {convites.map((a) => (
              <li key={a.id}
                  className="flex flex-wrap items-center gap-2.5 rounded-xl border border-borda border-dashed px-3.5 py-2.5">
                <div className="mr-auto min-w-0">
                  <p className="truncate text-sm">{a.rotulo}</p>
                  <p className="text-xs text-suave">
                    {nomeDe(a.usuario_id)}
                    {a.expira_em && ` · vale até ${quando(a.expira_em)}`}
                  </p>
                </div>
                <Pilula cor="neutro">não usado</Pilula>
                <button type="button" disabled={ocupado} title="Cancelar o convite"
                        className="text-suave hover:text-perigo"
                        onClick={() => iniciar(async () => {
                          await revogarAparelho(a.id); router.refresh();
                        })}>
                  <X size={14} />
                </button>
              </li>
            ))}
          </ul>
        </>
      )}

      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
        Liberados
      </p>
      {liberados.length === 0 ? (
        <p className="text-xs text-suave">
          Nenhum ainda. Libere o seu antes de ligar a trava.
        </p>
      ) : (
        <ul className="space-y-2">
          {liberados.map((a) => (
            <li key={a.id}
                className="flex flex-wrap items-center gap-2.5 rounded-xl border border-borda bg-superficie-alta px-3.5 py-2.5">
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-semibold">{a.rotulo}</p>
                <p className="text-xs text-suave">
                  {nomeDe(a.usuario_id)}
                  {a.ultimo_uso_em && ` · usado em ${quando(a.ultimo_uso_em)}`}
                </p>
              </div>
              <button type="button" disabled={ocupado} title="Tirar este aparelho do ar"
                      className="text-suave hover:text-perigo"
                      onClick={() => iniciar(async () => {
                        const r = await revogarAparelho(a.id);
                        if (r.ok) { setErro(null); router.refresh(); } else setErro(r.erro);
                      })}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </Cartao>
  );
}

function quando(iso: string): string {
  return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
}
