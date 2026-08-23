'use client';

import { useState, useTransition } from 'react';
import { Aviso, Botao } from '@/components/ui';
import { descadastrar } from './acoes';

export function Descadastro({ token }: { token: string }) {
  const [fase, setFase] = useState<'inicio' | 'confirmar' | 'pronto'>('inicio');
  const [enviando, iniciar] = useTransition();

  if (fase === 'pronto') {
    return (
      <Aviso tom="ok">
        Pronto. Seu contato foi retirado da lista e o número será apagado em até 48 horas.
        Você não receberá mais mensagens da campanha.
      </Aviso>
    );
  }

  if (fase === 'confirmar') {
    return (
      <div className="rounded-lg border border-borda bg-fundo p-4">
        <p className="mb-3 text-sm">
          Confirma? Seu número sai da lista agora e é apagado em até 48 horas.
        </p>
        <div className="flex flex-wrap gap-2">
          <Botao
            variante="perigo"
            disabled={enviando}
            onClick={() => iniciar(async () => { await descadastrar(token); setFase('pronto'); })}
          >
            {enviando ? 'Retirando…' : 'Sim, não quero receber'}
          </Botao>
          <Botao variante="fantasma" onClick={() => setFase('inicio')} disabled={enviando}>
            Cancelar
          </Botao>
        </div>
      </div>
    );
  }

  return (
    <button
      type="button"
      onClick={() => setFase('confirmar')}
      className="text-sm text-suave underline underline-offset-4 hover:text-texto"
    >
      Não quero mais receber mensagens
    </button>
  );
}
