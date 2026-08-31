'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Puzzle } from 'lucide-react';
import { Cartao } from '@/components/ui';
import { estadoDaExtensao, type EstadoDaExtensao } from '@/lib/whatsapp-aba';

/**
 * "A sua extensão está desatualizada."
 *
 * ⚠️ SÓ APARECE PARA QUEM TEM A VERSÃO ANTIGA INSTALADA, e essa distinção é o
 * ponto todo. O painel funciona 100% numa aba comum — a extensão sempre foi
 * conforto, não requisito. Avisar "atualize a extensão" para quem nunca
 * instalou seria pedir uma tarefa que não existe, no alto da tela em que a
 * pessoa trabalha o dia inteiro.
 *
 * A detecção está em `estadoDaExtensao()`: quem roda dentro do painel lateral e
 * mesmo assim não consegue falar com a extensão tem uma anterior à 1.1.0.
 *
 * Não é dispensável de propósito. Enquanto não atualizar, cada conversa abre
 * uma aba nova de WhatsApp Web — que é justamente a queixa que a 1.1.0 veio
 * resolver. Um aviso que se fecha some no primeiro clique e a máquina fica
 * assim até alguém reclamar de novo.
 */
export function AvisoExtensaoAntiga({ rotaInstalar }: { rotaInstalar: string }) {
  const [estado, setEstado] = useState<EstadoDaExtensao>('verificando');

  useEffect(() => {
    let vivo = true;
    void estadoDaExtensao().then((e) => { if (vivo) setEstado(e); });
    return () => { vivo = false; };
  }, []);

  if (estado !== 'antiga') return null;

  return (
    <Cartao className="mb-5 border-alerta/45 bg-alerta/[0.08] p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-alerta/15 text-alerta">
          <Puzzle size={16} />
        </span>
        <div className="mr-auto min-w-0">
          <p className="text-sm font-semibold text-alerta">
            Sua extensão está desatualizada
          </p>
          <p className="mt-0.5 text-xs leading-relaxed text-suave">
            Por isso o WhatsApp abre numa aba nova a cada conversa. A versão nova usa a aba que
            já está aberta. Leva dois minutos e você só faz uma vez.
          </p>
        </div>
        <Link
          href={rotaInstalar}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full border border-alerta/40 bg-alerta/10 px-4 py-2 text-xs font-medium text-alerta transition-colors hover:bg-alerta/16"
        >
          Como atualizar <ArrowRight size={13} />
        </Link>
      </div>
    </Cartao>
  );
}
