'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Aviso, Botao, Campo } from '@/components/ui';
import type { Municipio } from '@/lib/tipos-banco';
import { pedirKit } from './acoes';

const ITENS = [
  { valor: 'santinho', rotulo: 'Santinho', dica: 'para entregar a amigos e vizinhos' },
  { valor: 'adesivo', rotulo: 'Adesivo de carro', dica: 'roda a cidade com você' },
  { valor: 'camiseta', rotulo: 'Camiseta', dica: 'informe o tamanho no endereço' },
];

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" tamanho="g" className="w-full" disabled={pending}>
      {pending ? 'Enviando…' : 'Quero receber meu kit'}
    </Botao>
  );
}

export function FormularioKit({ municipios }: { municipios: Municipio[] }) {
  const [estado, acao] = useActionState(pedirKit, null);

  if (estado?.ok) {
    return (
      <Aviso tom="ok" className="text-base">
        <p className="font-medium">Obrigado, {estado.nome}!</p>
        <p className="mt-1">
          Recebemos seu pedido. Em breve alguém da campanha fala com você pelo WhatsApp para
          combinar a entrega.
        </p>
      </Aviso>
    );
  }

  return (
    <form action={acao} className="space-y-4">
      <Campo rotulo="Seu nome" name="nome" required autoComplete="name" placeholder="Nome e sobrenome" />
      <Campo
        rotulo="Seu WhatsApp"
        name="telefone"
        type="tel"
        required
        autoComplete="tel"
        placeholder="(69) 99999-0000"
        dica="Com DDD. Precisa ser um celular com WhatsApp."
      />

      <label className="block">
        <span className="mb-1.5 block text-sm font-medium">Sua cidade</span>
        <select
          name="municipio_id"
          required
          defaultValue=""
          className="w-full rounded-lg border border-borda bg-superficie px-3.5 py-2.5 text-base"
        >
          <option value="" disabled>Escolha…</option>
          {municipios.map((m) => (
            <option key={m.id} value={m.id}>{m.nome}</option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="mb-1.5 text-sm font-medium">O que você quer receber</legend>
        <div className="space-y-2">
          {ITENS.map((i) => (
            <label
              key={i.valor}
              className="flex cursor-pointer items-start gap-3 rounded-lg border border-borda bg-superficie p-3"
            >
              <input type="checkbox" name="itens" value={i.valor} className="mt-0.5 size-5 accent-[var(--acento)]" />
              <span>
                <span className="block text-sm font-medium">{i.rotulo}</span>
                <span className="block text-xs text-suave">{i.dica}</span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      <Campo
        rotulo="Endereço para entrega"
        name="endereco"
        placeholder="Rua, número, bairro — e o tamanho da camiseta, se pediu"
        dica="Opcional. Ajuda a entregar sem precisar ligar."
      />

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-borda bg-fundo p-4">
        <input type="checkbox" name="aceite" required className="mt-0.5 size-5 accent-[var(--acento)]" />
        <span className="text-sm">
          Autorizo o contato pelo WhatsApp para combinar a entrega e receber material da campanha.
          Posso pedir para sair quando quiser.
        </span>
      </label>

      {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}

      <BotaoEnviar />
    </form>
  );
}
