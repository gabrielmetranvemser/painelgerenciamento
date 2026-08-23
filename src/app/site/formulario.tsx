'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { Aviso, Botao, Campo } from '@/components/ui';
import type { Municipio } from '@/lib/tipos-banco';
import { cadastrar } from './acoes';

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" tamanho="g" className="w-full" disabled={pending}>
      {pending ? 'Enviando…' : 'Quero receber'}
    </Botao>
  );
}

export function FormularioSite({ municipios }: { municipios: Municipio[] }) {
  const [estado, acao] = useActionState(cadastrar, null);

  if (estado?.ok) {
    return (
      <Aviso tom="ok" className="text-base">
        <p className="font-medium">Obrigado, {estado.nome}!</p>
        <p className="mt-1">
          Em breve alguém da campanha fala com você pelo WhatsApp. Se mudar de ideia, é só pedir
          para sair na própria conversa.
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

      <label className="flex cursor-pointer items-start gap-3 rounded-lg border border-borda bg-fundo p-4">
        <input type="checkbox" name="aceite" required className="mt-0.5 size-5 accent-[var(--acento)]" />
        <span className="text-sm">
          Autorizo receber contato pelo WhatsApp com material da campanha.
          Posso pedir para sair quando quiser.
        </span>
      </label>

      {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}

      <BotaoEnviar />
    </form>
  );
}
