import { notFound } from 'next/navigation';

/**
 * A raiz não existe.
 *
 * Só respondem os endereços dos candidatos (/{slug}) e o painel, sob o
 * segmento secreto. Quem digitar só o domínio recebe 404 — sem redirecionar,
 * sem mensagem, sem nada que diga o que roda aqui.
 */
export default function Raiz() {
  notFound();
}
