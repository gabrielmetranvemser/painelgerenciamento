'use client';

import { useState, useTransition } from 'react';
import { aceitarTermo } from './acoes';
import { Aviso, Botao } from '@/components/ui';

export function FormularioTermo({ entrada }: { entrada: string }) {
  const [marcado, setMarcado] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, iniciar] = useTransition();

  return (
    <div className="space-y-4">
      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-borda bg-superficie-alta p-5 transition-colors hover:border-borda-forte">
        <input
          type="checkbox"
          checked={marcado}
          onChange={(e) => setMarcado(e.target.checked)}
          className="mt-0.5 size-5 accent-[var(--acento)]"
        />
        <span className="text-sm">
          Li e concordo. Entendo que <strong>o número que aparece numa eventual denúncia é o meu</strong>,
          e que não sou remunerado por mensagem enviada.
        </span>
      </label>

      {erro && <Aviso tom="erro">{erro}</Aviso>}

      <Botao
        tamanho="g"
        className="w-full"
        disabled={!marcado || enviando}
        onClick={() => iniciar(async () => setErro(await aceitarTermo(entrada)))}
      >
        {enviando ? 'Gravando…' : 'Aceitar e começar'}
      </Botao>
    </div>
  );
}
