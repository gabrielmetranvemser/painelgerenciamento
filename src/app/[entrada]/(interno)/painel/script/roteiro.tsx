'use client';

import { useState } from 'react';
import { Check, Copy, Lock, TriangleAlert } from 'lucide-react';
import { Aviso, Cartao, Titulo, cx } from '@/components/ui';
import {
  ABERTURA_DO_SCRIPT, REGRAS_DO_SCRIPT, SCRIPT, preencherScript,
  type BlocoDoScript, type DadosDoScript,
} from '@/lib/script-apoio';

/**
 * O roteiro na tela, com cada fala pronta para copiar.
 *
 * Copiar é o gesto central desta página: quem consulta está com uma pessoa
 * esperando resposta do outro lado, e reescrever à mão custa mais que o texto
 * vale. É o mesmo motivo pelo qual o "Como agir" da lateral copia.
 */
export function Roteiro({
  primeiroNome, dados, chapa,
}: {
  primeiroNome: string;
  dados: DadosDoScript;
  chapa: { nome: string; cargo: string; numero: string }[];
}) {
  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <Titulo sub={ABERTURA_DO_SCRIPT.linha}>{ABERTURA_DO_SCRIPT.titulo}</Titulo>

      {chapa.length === 0 ? (
        <Aviso tom="alerta" icone={<TriangleAlert size={16} />}>
          Você ainda não tem candidato atribuído, então o roteiro fala em [CANDIDATO] onde deveria
          ter um nome. Peça ao gestor para montar sua chapa.
        </Aviso>
      ) : (
        <Aviso tom="info">
          Os nomes já estão preenchidos com a sua chapa:{' '}
          {chapa.map((c) => `${c.nome} (${c.cargo}, ${c.numero})`).join(' · ')}. Onde estiver{' '}
          <strong>[O SEU MOTIVO]</strong>, escreva o seu — é a única parte que não dá para copiar
          de ninguém, {primeiroNome}.
        </Aviso>
      )}

      <ol className="space-y-3">
        {SCRIPT.map((b) => <BlocoNaTela key={b.numero} bloco={b} dados={dados} />)}
      </ol>

      <Cartao className="p-5">
        <p className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
          As regras
        </p>
        <ol className="space-y-2.5">
          {REGRAS_DO_SCRIPT.map((r, i) => (
            <li key={r} className="flex gap-2.5 text-sm leading-relaxed text-suave">
              <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-superficie-alta text-[9px] font-bold text-texto">
                {i + 1}
              </span>
              {r}
            </li>
          ))}
        </ol>
      </Cartao>
    </div>
  );
}

function BlocoNaTela({ bloco, dados }: { bloco: BlocoDoScript; dados: DadosDoScript }) {
  return (
    <li>
      <Cartao className="p-5">
        <div className="flex items-baseline gap-2.5">
          <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-acento/12 font-display text-xs font-bold text-acento">
            {bloco.numero}
          </span>
          <div className="min-w-0">
            <h2 className="font-display text-lg font-semibold tracking-tight">{bloco.titulo}</h2>
            {bloco.quando && <p className="mt-0.5 text-xs text-suave">{bloco.quando}</p>}
          </div>
        </div>

        {/* ⚠️ Material e convite ao canal NÃO ganham botão de copiar. O link
            deles é por pessoa e sai do painel; texto colado com link de outro
            lugar não registra o clique daquele contato, e o clique é a única
            métrica confiável do projeto. Aqui o bloco fica só como referência
            do que a pessoa vai receber. */}
        {bloco.montaNoPainel && (
          <p className="mt-3 flex items-start gap-2 rounded-lg bg-superficie-alta px-3 py-2 text-xs leading-relaxed text-suave">
            <Lock size={13} className="mt-0.5 shrink-0" />
            <span>
              Esta o painel monta para você, com o link certo daquela pessoa. Está aqui só para
              você saber o que ela vai receber — não copie daqui.
            </span>
          </p>
        )}

        {bloco.falas.length > 0 && (
          <div className="mt-3 space-y-2">
            {bloco.falas.map((f, i) => (
              <Fala key={i} texto={preencherScript(f, dados)} copiavel={!bloco.montaNoPainel} />
            ))}
          </div>
        )}

        {/* Só onde a escolha é de quem escreve. No bloco que o painel monta,
            quem escolhe é a rotação de variação por chip. */}
        {bloco.falas.length > 1 && !bloco.montaNoPainel && (
          <p className="mt-2 text-xs text-suave">Escolha uma. Não mande as duas juntas.</p>
        )}

        {bloco.exemplos && (
          <div className="mt-4 border-t border-borda pt-3">
            <p className="text-xs font-semibold text-ok">Motivos que funcionam</p>
            <ul className="mt-1.5 space-y-1">
              {bloco.exemplos.map((e) => (
                <li key={e} className="text-xs leading-relaxed text-suave">— “{e}”</li>
              ))}
            </ul>
            {bloco.evite && (
              <p className="mt-2.5 text-xs leading-relaxed text-perigo">
                <span className="font-semibold">Não use:</span> {bloco.evite}
              </p>
            )}
          </div>
        )}

        {bloco.nota && (
          <p className="mt-3 text-xs leading-relaxed text-alerta">{bloco.nota}</p>
        )}

        {bloco.marque && (
          <p className="mt-2 text-xs font-medium text-acento">→ {bloco.marque}</p>
        )}
      </Cartao>
    </li>
  );
}

function Fala({ texto, copiavel }: { texto: string; copiavel: boolean }) {
  const [copiado, setCopiado] = useState(false);

  return (
    <div className={cx(
      'rounded-2xl rounded-tl-md border border-borda bg-superficie-alta p-4',
      !copiavel && 'opacity-70',
    )}>
      <p className="whitespace-pre-wrap text-[15px] leading-[1.7]">{texto}</p>
      {copiavel && (
        <button
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(texto);
            setCopiado(true);
            setTimeout(() => setCopiado(false), 1500);
          }}
          className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-acento hover:underline"
        >
          {copiado ? <><Check size={12} /> copiado</> : <><Copy size={12} /> copiar</>}
        </button>
      )}
    </div>
  );
}
