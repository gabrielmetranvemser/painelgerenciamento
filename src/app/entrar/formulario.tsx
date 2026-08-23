'use client';

import { useActionState } from 'react';
import { useFormStatus } from 'react-dom';
import { entrar } from './acoes';
import { Aviso, Botao, Campo } from '@/components/ui';

function BotaoEntrar() {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" tamanho="g" className="w-full" disabled={pending}>
      {pending ? 'Entrando…' : 'Entrar'}
    </Botao>
  );
}

export function FormularioEntrar({ proximo }: { proximo: string }) {
  const [erro, acao] = useActionState(entrar, null);

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="proximo" value={proximo} />
      <Campo
        rotulo="E-mail"
        name="email"
        type="email"
        autoComplete="username"
        autoFocus
        required
        placeholder="voce@exemplo.com"
      />
      <Campo rotulo="Senha" name="senha" type="password" autoComplete="current-password" required />
      {erro && <Aviso tom="erro">{erro}</Aviso>}
      <BotaoEntrar />
    </form>
  );
}
