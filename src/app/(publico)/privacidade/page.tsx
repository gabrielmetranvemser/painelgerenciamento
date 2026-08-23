import type { Metadata } from 'next';
import { criarClienteAdmin } from '@/lib/supabase/admin';

// Lê a configuração a cada acesso: o gestor edita o responsável pelos dados
// pelo painel, e a página não pode ficar congelada no que valia no build.
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Privacidade',
  description: 'Como seus dados são usados e como pedir para sair da lista.',
  // Nada é indexável (ver src/app/robots.ts). Esta página é alcançada pelo
  // link que a própria pessoa recebeu.
  robots: { index: false, follow: false },
};

export default async function Privacidade() {
  const supabase = criarClienteAdmin();
  const { data: cfg } = await supabase
    .from('config')
    .select('responsavel_dados')
    .eq('id', 1)
    .single();

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 text-[15px] leading-[1.7] sm:px-6">
      <h1 className="mb-8 font-display text-3xl font-semibold tracking-tight">Como tratamos seus dados</h1>

      <Secao titulo="O que guardamos">
        Nome, telefone e cidade. Se você pediu material impresso, também o endereço de entrega.
        Guardamos ainda a data e a hora em que você abriu o link que recebeu.
      </Secao>

      <Secao titulo="O que NÃO guardamos">
        Não registramos em quem você vota, nem sua opinião política. Não existe campo para isso
        em nenhum lugar do nosso sistema.
      </Secao>

      {/* Qual candidatura é qual está na página do material que a pessoa
          recebeu, e na frase que ela marcou ao se cadastrar — os dois trazem o
          nome. Nomear um candidato AQUI seria nomear o errado para quem chegou
          por outro. */}
      <Secao titulo="Para que usamos">
        Apenas para o contato da candidatura que você autorizou. O nome dela está na frase que
        você marcou ao se cadastrar e na página do material que recebeu. Não vendemos, não
        cedemos e não trocamos seus dados com ninguém.
      </Secao>

      <Secao titulo="Como sair">
        Responda &ldquo;não quero receber&rdquo; para quem falou com você, ou use o botão de
        descadastro na página do material. Seu contato sai da lista na hora e o número é apagado
        em até 48 horas. Depois disso não voltamos a falar com você, mesmo que seu número apareça
        em outra lista.
      </Secao>

      <Secao titulo="Quem conversa com você">
        Uma pessoa, pelo WhatsApp dela, uma conversa por vez. Não usamos robô nem disparo
        automático.
      </Secao>

      {cfg?.responsavel_dados && (
        <Secao titulo="Contato">{cfg.responsavel_dados}</Secao>
      )}
    </main>
  );
}

function Secao({ titulo, children }: { titulo: string; children: React.ReactNode }) {
  return (
    <section className="mb-6">
      <h2 className="mb-2 font-display text-lg font-semibold tracking-tight">{titulo}</h2>
      <p className="text-suave">{children}</p>
    </section>
  );
}
