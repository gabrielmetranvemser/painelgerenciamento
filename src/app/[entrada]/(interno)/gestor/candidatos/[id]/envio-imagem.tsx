'use client';

import { useRef, useState, useTransition } from 'react';
import { ImageUp, Loader2, Trash2 } from 'lucide-react';
import { Aviso, Botao } from '@/components/ui';
import { ErroImagem, paraWebp } from '@/lib/imagem';
import { enviarImagem, removerImagem, type TipoImagem } from '../acoes';

/**
 * Escolher, converter e guardar uma imagem.
 *
 * A conversão para WebP roda no navegador (ver src/lib/imagem.ts): sobe o
 * arquivo pequeno, o gestor vê a prévia antes de gravar, e o servidor não
 * precisa de `sharp`. O servidor confere o que chegou — cliente se burla pelo
 * DevTools, e balde público que aceita qualquer coisa vira hospedagem alheia.
 */
export function EnvioImagem({
  candidatoId, tipo, rotulo, dica, ladoMaximo, urlAtual, aoMudar,
}: {
  candidatoId: string;
  tipo: TipoImagem;
  rotulo: string;
  dica: string;
  /** Maior lado depois de reduzida. Logo não precisa de 2000px; fundo precisa. */
  ladoMaximo: number;
  urlAtual: string | null;
  aoMudar: (url: string | null) => void;
}) {
  const [url, setUrl] = useState(urlAtual);
  const [erro, setErro] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const entrada = useRef<HTMLInputElement>(null);

  function escolher(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null); setInfo(null);
    iniciar(async () => {
      try {
        const pronta = await paraWebp(arquivo, { ladoMaximo, nome: tipo });
        const form = new FormData();
        form.set('arquivo', pronta.arquivo);
        const r = await enviarImagem(candidatoId, tipo, form);
        if (!r.ok) { setErro(r.erro); return; }
        setUrl(r.url);
        aoMudar(r.url);
        setInfo(
          `${pronta.largura}×${pronta.altura}, ${(pronta.bytes / 1024).toFixed(0)} KB ` +
          `(de ${(arquivo.size / 1024).toFixed(0)} KB)`,
        );
      } catch (e) {
        setErro(e instanceof ErroImagem ? e.message : 'Não consegui processar a imagem.');
      } finally {
        if (entrada.current) entrada.current.value = '';
      }
    });
  }

  return (
    <div>
      <p className="mb-2 text-[13px] font-semibold">{rotulo}</p>

      {url && (
        <div className="mb-2.5 overflow-hidden rounded-2xl border border-borda bg-[repeating-conic-gradient(var(--superficie-alta)_0_25%,transparent_0_50%)] bg-[length:16px_16px] p-3">
          {/* Xadrez por trás de propósito: logo com fundo transparente precisa
              parecer transparente aqui, senão o gestor só descobre no ar. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={url} alt="" className="mx-auto max-h-28 w-auto object-contain" />
        </div>
      )}

      <input ref={entrada} type="file" accept="image/*" className="hidden"
             onChange={(e) => escolher(e.target.files?.[0])} />

      <div className="flex flex-wrap items-center gap-2">
        <Botao type="button" variante="neutro" tamanho="p" disabled={ocupado}
               onClick={() => entrada.current?.click()}>
          {ocupado
            ? <><Loader2 size={13} className="animate-spin" /> Convertendo…</>
            : <><ImageUp size={13} /> {url ? 'Trocar' : 'Escolher arquivo'}</>}
        </Botao>

        {url && (
          <button type="button" disabled={ocupado} title="Remover"
                  className="inline-flex items-center gap-1.5 text-xs text-suave transition-colors hover:text-perigo disabled:opacity-45"
                  onClick={() => iniciar(async () => {
                    const r = await removerImagem(candidatoId, tipo);
                    if (!r.ok) { setErro(r.erro); return; }
                    setUrl(null); aoMudar(null); setInfo(null);
                  })}>
            <Trash2 size={13} /> remover
          </button>
        )}

        {info && <span className="text-xs text-ok">{info}</span>}
      </div>

      <p className="mt-2 text-xs leading-relaxed text-suave">{dica}</p>
      {erro && <Aviso tom="erro" className="mt-2">{erro}</Aviso>}
    </div>
  );
}
