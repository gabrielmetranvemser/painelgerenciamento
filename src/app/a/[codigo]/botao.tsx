'use client';

import { useFormStatus } from 'react-dom';
import { Botao } from '@/components/ui';

/**
 * Trava no primeiro toque. O convite é de uso único: um segundo envio chegaria
 * com o código já gasto e responderia 404 — por cima da liberação que acabou
 * de dar certo.
 */
export function BotaoLiberar() {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" tamanho="g" className="w-full" disabled={pending}>
      {pending ? 'Liberando…' : 'Liberar este aparelho'}
    </Botao>
  );
}
