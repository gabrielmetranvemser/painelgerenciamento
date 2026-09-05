import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { chegouPeloEnderecoAntigo } from '@/lib/dominios-candidatos';
import { Aviso } from '@/components/ui';
import { PaginaDoMaterial } from '@/components/pagina-do-material';
import type { CargoEleitoral, TipoMaterial } from '@/lib/tipos-banco';
import { Descadastro } from './descadastro';

// Página pessoal, uma por contato: nunca deve ser indexada.
export const metadata: Metadata = {
  title: 'Material da campanha',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

type Pagina = {
  ok: boolean;
  motivo?: string;
  contato_id: string;
  descadastrado: boolean;
  candidato: {
    id: string;
    nome_urna: string; cargo: CargoEleitoral; numero: string;
    partido_sigla: string | null; coligacao: string | null;
    cnpj_campanha: string | null; responsavel_material: string | null;
    foto_url: string | null; cor_tema: string | null;
    slogan: string | null; chamada: string | null; propostas: string | null;
    ativo: boolean;
  };
  materiais: { titulo: string; descricao: string | null; tipo: TipoMaterial; token: string }[];
};

/**
 * A página do material.
 *
 * É para cá que o {{link}} da mensagem aponta — um link só, em vez de despejar
 * quatro URLs cruas no WhatsApp. Aqui cabe o que a mensagem não comporta: a
 * identificação da propaganda, o CNPJ e o botão de sair, que é o que sustenta
 * a defesa se alguém questionar.
 *
 * Cada peça abre por /r/{token} próprio, então continua dando para saber o que
 * a pessoa abriu de verdade — e não só que "clicou no material".
 *
 * O desenho vem de `PaginaDoMaterial`, compartilhado com a prévia do gestor:
 * uma prévia que divergisse desta página seria pior que prévia nenhuma.
 */
export default async function PaginaMaterial({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = criarClienteAdmin();

  const { data } = await supabase.rpc('pagina_material', { p_token: token });
  const p = data as Pagina | null;
  if (!p?.ok) notFound();

  // Chegou pelo endereço antigo de quem já tem domínio próprio: aqui não existe
  // mais nada deste candidato.
  if (await chegouPeloEnderecoAntigo({ id: p.candidato.id })) notFound();

  const c = p.candidato;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 sm:px-6">
      {p.descadastrado ? (
        <Aviso tom="ok" className="text-base">
          Seu contato já foi retirado da lista. Não vamos mais falar com você, e o número é
          apagado em até 48 horas.
        </Aviso>
      ) : (
        <PaginaDoMaterial
          candidato={c}
          pecas={p.materiais.map((m) => ({
            chave: m.token,
            titulo: m.titulo,
            descricao: m.descricao,
            tipo: m.tipo,
            // Cada peça pelo SEU token: é o que separa "abriu o santinho" de
            // "abriu o vídeo" no relatório.
            href: `/r/${m.token}`,
          }))}
          saida={<Descadastro token={token} />}
        />
      )}
    </main>
  );
}
