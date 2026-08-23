'use client';

import { useActionState, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Aviso, Botao, Campo, cx } from '@/components/ui';
import type { Municipio } from '@/lib/tipos-banco';
import { cadastrar } from './acoes';

const ITENS = [
  { valor: 'santinho', rotulo: 'Santinho' },
  { valor: 'adesivo', rotulo: 'Adesivo de carro' },
  { valor: 'camiseta', rotulo: 'Camiseta' },
];

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" tamanho="g" className="w-full" disabled={pending}>
      {pending ? 'Enviando…' : 'Quero receber o material'}
    </Botao>
  );
}

export function FormularioCandidato({
  slug, aceite, municipios,
}: {
  slug: string;
  /** A MESMA frase que o servidor grava como prova. Ver src/lib/consentimento.ts. */
  aceite: string;
  municipios: Municipio[];
}) {
  const [estado, acao] = useActionState(cadastrar, null);
  const [querImpresso, setQuerImpresso] = useState(false);

  if (estado?.ok) {
    return (
      <Aviso tom="ok" className="text-base">
        <p className="font-medium">Obrigado, {estado.nome}!</p>
        <p className="mt-1">
          Em breve alguém da equipe fala com você pelo WhatsApp e manda o material.
          Se mudar de ideia, é só pedir para sair na própria conversa.
        </p>
      </Aviso>
    );
  }

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />

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
        <span className="mb-2 block text-[13px] font-semibold">Sua cidade</span>
        <select
          name="municipio_id"
          required
          defaultValue=""
          className="w-full rounded-2xl border border-borda bg-superficie-alta px-4 py-3 text-[15px]"
        >
          <option value="" disabled>Escolha…</option>
          {municipios.map((m) => (
            <option key={m.id} value={m.id}>{m.nome}</option>
          ))}
        </select>
      </label>

      {/* O impresso é opcional e fica fechado: formulário curto converte mais, e
          a maioria só quer o material digital. */}
      <div className="rounded-2xl border border-borda">
        <label className="flex cursor-pointer items-center gap-3 p-4">
          <input
            type="checkbox"
            checked={querImpresso}
            onChange={(e) => setQuerImpresso(e.target.checked)}
            className="size-5 accent-[var(--acento)]"
          />
          <span className="text-sm font-medium">Quero também material impresso</span>
        </label>

        <div className={cx('space-y-3 border-t border-borda p-4', querImpresso ? 'block' : 'hidden')}>
          {ITENS.map((i) => (
            <label key={i.valor} className="flex cursor-pointer items-center gap-3">
              <input type="checkbox" name="itens" value={i.valor} disabled={!querImpresso}
                     className="size-5 accent-[var(--acento)]" />
              <span className="text-sm">{i.rotulo}</span>
            </label>
          ))}
          <label className="block">
            <span className="mb-2 block text-[13px] font-semibold">Endereço para entrega</span>
            <textarea
              name="endereco" rows={2} disabled={!querImpresso} maxLength={300}
              placeholder="Rua, número, bairro, ponto de referência — e o tamanho da camiseta"
              className="w-full resize-y rounded-2xl border border-borda bg-superficie-alta px-4 py-3 text-[15px] leading-relaxed placeholder:text-tenue"
            />
          </label>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-borda bg-superficie-alta p-5">
        <input type="checkbox" name="aceite" required className="mt-0.5 size-5 shrink-0 accent-[var(--acento)]" />
        <span className="text-sm leading-relaxed">{aceite}</span>
      </label>

      {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}

      <BotaoEnviar />
    </form>
  );
}
