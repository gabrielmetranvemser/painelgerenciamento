import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { Laptop } from 'lucide-react';
import { Cartao } from '@/components/ui';
import { conviteDeAparelhoValido } from '@/lib/aparelho-servidor';
import { hostEhDoPainel } from '@/lib/host-do-painel';
import { liberarEsteAparelho } from './acoes';
import { BotaoLiberar } from './botao';

export const dynamic = 'force-dynamic';

/**
 * Abrir o link de liberação. ABRIR NÃO LIBERA — o botão é que libera.
 *
 * ⚠️ O endereço é NEUTRO de propósito: `/a/{codigo}`, e não algo embaixo do
 * segmento secreto. O gestor manda este link por WhatsApp, e um link que
 * carregasse a chave a espalharia por toda conversa — exatamente o que a chave
 * existe para evitar.
 *
 * ⚠️ Fica FORA do portão do proxy (não começa com a chave), senão ninguém
 * conseguiria liberar o primeiro aparelho.
 *
 * ⚠️ Esta página é aberta também por ROBÔ: o mensageiro busca o link para
 * montar a pré-visualização assim que ele é colado na conversa. Por isso ela
 * não gasta nada (quem gasta é o toque, em `acoes.ts`) e não diz nome de
 * ninguém, de campanha nem de painel — o título é o neutro da raiz, e é ele
 * que aparece na pré-visualização.
 *
 * Convite errado, vencido, usado ou cancelado: 404, o mesmo de qualquer
 * endereço inexistente.
 */
export default async function LiberarAparelho({
  params,
}: {
  params: Promise<{ codigo: string }>;
}) {
  const h = await headers();
  if (!hostEhDoPainel(h.get('x-forwarded-host') ?? h.get('host'))) notFound();

  const { codigo } = await params;
  if (!(await conviteDeAparelhoValido(codigo))) notFound();

  return (
    <main className="flex flex-1 items-center justify-center p-6">
      <div className="surgir w-full max-w-sm">
        <div className="mb-8 text-center">
          <span className="mx-auto mb-4 grid size-12 place-items-center rounded-2xl bg-acento text-tinta-acento">
            <Laptop size={22} />
          </span>
          <h1 className="font-display text-3xl font-semibold tracking-tight">Liberar este aparelho</h1>
          <p className="mt-1.5 text-sm text-suave">
            Faça isto no aparelho e no navegador em que você vai trabalhar.
          </p>
        </div>

        <Cartao className="p-7" elevado>
          <form action={liberarEsteAparelho.bind(null, codigo)}>
            <BotaoLiberar />
          </form>
          <p className="mt-4 text-xs leading-relaxed text-suave">
            O link serve uma vez só. Se este não é o aparelho certo, feche a página
            sem tocar no botão — o link continua valendo para o aparelho certo.
          </p>
        </Cartao>
      </div>
    </main>
  );
}
