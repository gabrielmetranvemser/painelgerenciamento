'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { ImageUp, Loader2, Paperclip, Send } from 'lucide-react';
import { Aviso, Botao, Cartao, Pilula, cx } from '@/components/ui';
import { ErroImagem, paraWebp } from '@/lib/imagem';
import { formatarExibicao } from '@/lib/telefone';
import {
  ROTULO_MOTIVO, ROTULO_STATUS_CHAMADO,
  type ChamadoNaLista, type MotivoChamado, type StatusChamado,
} from '@/lib/tipos-banco';
import {
  carregarConversa, enviarAnexo, mudarStatusChamado, responderChamado, type Conversa,
} from '@/app/[entrada]/(interno)/suporte/acoes';

/**
 * Print é texto: comprimir demais borra a letra e o gestor não lê a conversa
 * que o atendente quis mostrar. Qualidade alta e lado grande, de propósito.
 */
export const AJUSTE_PRINT = { ladoMaximo: 1800, qualidade: 0.92 };

export const COR_MOTIVO: Record<MotivoChamado, 'neutro' | 'perigo' | 'alerta' | 'frio' | 'quente'> = {
  juridico: 'perigo',
  contato: 'quente',
  tecnico: 'frio',
  material: 'alerta',
  outro: 'neutro',
};

const COR_STATUS: Record<StatusChamado, 'neutro' | 'alerta' | 'acento'> = {
  aberto: 'alerta',
  em_analise: 'neutro',
  resolvido: 'acento',
};

const quando = (iso: string) =>
  new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

export function CartaoChamado({
  chamado, entrada, souGestor, aoMudar,
}: {
  chamado: ChamadoNaLista;
  entrada: string;
  souGestor: boolean;
  aoMudar: () => void;
}) {
  const [aberto, setAberto] = useState(false);
  const [conversa, setConversa] = useState<Conversa | null>(null);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const entradaArquivo = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (aberto && !conversa) void carregarConversa(chamado.id).then(setConversa);
  }, [aberto, conversa, chamado.id]);

  function recarregar() {
    void carregarConversa(chamado.id).then(setConversa);
    aoMudar();
  }

  function enviar() {
    if (!texto.trim()) return;
    setErro(null);
    const t = texto;
    iniciar(async () => {
      const r = await responderChamado(chamado.id, t);
      if (!r.ok) { setErro(r.erro); return; }
      setTexto('');
      recarregar();
    });
  }

  function anexar(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    iniciar(async () => {
      try {
        const pronta = await paraWebp(arquivo, { ...AJUSTE_PRINT, nome: 'print' });
        const form = new FormData();
        form.set('arquivo', pronta.arquivo);
        form.set('largura', String(pronta.largura));
        form.set('altura', String(pronta.altura));
        const r = await enviarAnexo(chamado.id, form);
        if (!r.ok) { setErro(r.erro); return; }
        recarregar();
      } catch (e) {
        setErro(e instanceof ErroImagem ? e.message : 'Não consegui processar a imagem.');
      } finally {
        if (entradaArquivo.current) entradaArquivo.current.value = '';
      }
    });
  }

  return (
    <Cartao className={cx('overflow-hidden', chamado.motivo === 'juridico' && chamado.status !== 'resolvido' && 'border-perigo/35')}>
      <button type="button" onClick={() => setAberto((a) => !a)}
              className="flex w-full flex-wrap items-center gap-2.5 px-5 py-4 text-left transition-colors hover:bg-superficie-alta/50">
        <Pilula cor={COR_MOTIVO[chamado.motivo]}>{ROTULO_MOTIVO[chamado.motivo]}</Pilula>

        <span className="mr-auto min-w-0">
          <span className="block truncate font-semibold">{chamado.assunto}</span>
          <span className="block text-xs text-suave">
            {souGestor && chamado.atendente ? `${chamado.atendente} · ` : ''}
            {quando(chamado.criado_em)}
            {chamado.contato && ` · sobre ${chamado.contato}`}
            {chamado.anexos > 0 && ` · ${chamado.anexos} print${chamado.anexos > 1 ? 's' : ''}`}
          </span>
        </span>

        {/* A bola está com o gestor quando a última fala foi do atendente. */}
        {souGestor && chamado.espera_gestor && chamado.status !== 'resolvido' && (
          <Pilula cor="alerta">esperando você</Pilula>
        )}
        <Pilula cor={COR_STATUS[chamado.status]}>{ROTULO_STATUS_CHAMADO[chamado.status]}</Pilula>
      </button>

      {aberto && (
        <div className="border-t border-borda px-5 py-4">
          {chamado.contato_telefone && (
            <p className="mb-3 text-xs text-suave">
              Contato: {chamado.contato ?? '—'} · {formatarExibicao(chamado.contato_telefone)}
              {chamado.chip && ` · pelo ${chamado.chip}`}
            </p>
          )}

          {!conversa ? (
            <p className="text-sm text-suave">carregando…</p>
          ) : (
            <>
              <ol className="space-y-3">
                {conversa.mensagens.map((m) => (
                  <li key={m.id}
                      className={cx('rounded-2xl border p-3.5',
                        m.autor_id === chamado.atendente_id
                          ? 'border-borda bg-superficie-alta'
                          : 'border-acento/25 bg-acento/[0.07]')}>
                    <p className="text-xs font-semibold text-suave">
                      {m.autor ?? 'conta removida'}
                      {m.autor_id !== chamado.atendente_id && ' · gestor'}
                      <span className="ml-2 font-normal">{quando(m.criado_em)}</span>
                    </p>
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed">{m.texto}</p>
                  </li>
                ))}
              </ol>

              {conversa.anexos.length > 0 && (
                <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
                  {conversa.anexos.map((a) => (
                    <a key={a.id} href={`/${entrada}/suporte/anexo/${a.id}`} target="_blank" rel="noopener"
                       className="block overflow-hidden rounded-2xl border border-borda transition-colors hover:border-borda-forte">
                      {/* Vem de rota autenticada, não de URL pública. */}
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/${entrada}/suporte/anexo/${a.id}`} alt="Print anexado"
                           loading="lazy" className="max-h-72 w-full bg-fundo object-contain" />
                    </a>
                  ))}
                </div>
              )}
            </>
          )}

          {erro && <Aviso tom="erro" className="mt-3">{erro}</Aviso>}

          <div className="mt-4 space-y-2.5">
            <textarea
              value={texto} onChange={(e) => setTexto(e.target.value)} rows={3} maxLength={4000}
              placeholder={souGestor ? 'Responder ao atendente…' : 'Escrever para o gestor…'}
              className="w-full resize-y rounded-2xl border border-borda bg-superficie-alta px-4 py-3 text-sm leading-relaxed placeholder:text-tenue"
            />

            <input ref={entradaArquivo} type="file" accept="image/*" className="hidden"
                   onChange={(e) => anexar(e.target.files?.[0])} />

            <div className="flex flex-wrap items-center gap-2">
              <Botao tamanho="p" disabled={ocupado || !texto.trim()} onClick={enviar}>
                {ocupado ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />} Enviar
              </Botao>
              <Botao variante="neutro" tamanho="p" disabled={ocupado}
                     onClick={() => entradaArquivo.current?.click()}>
                <ImageUp size={13} /> Anexar print
              </Botao>

              {souGestor && (
                <div className="ml-auto flex gap-2">
                  {chamado.status !== 'resolvido' ? (
                    <Botao variante="neutro" tamanho="p" disabled={ocupado}
                           onClick={() => iniciar(async () => {
                             const r = await mudarStatusChamado(chamado.id, 'resolvido');
                             if (!r.ok) { setErro(r.erro); return; }
                             recarregar();
                           })}>
                      Marcar resolvido
                    </Botao>
                  ) : (
                    <Botao variante="neutro" tamanho="p" disabled={ocupado}
                           onClick={() => iniciar(async () => {
                             const r = await mudarStatusChamado(chamado.id, 'em_analise');
                             if (!r.ok) { setErro(r.erro); return; }
                             recarregar();
                           })}>
                      Reabrir
                    </Botao>
                  )}
                </div>
              )}
            </div>
          </div>

          <p className="mt-3 flex items-start gap-2 text-xs leading-relaxed text-suave">
            <Paperclip size={12} className="mt-0.5 shrink-0" />
            O print fica guardado em local fechado e só você e o gestor abrem.
            Ainda assim, <strong className="text-texto">não anexe print que mostre em quem
            a pessoa vota</strong> — isso não pode ser registrado em lugar nenhum.
          </p>
        </div>
      )}
    </Cartao>
  );
}
