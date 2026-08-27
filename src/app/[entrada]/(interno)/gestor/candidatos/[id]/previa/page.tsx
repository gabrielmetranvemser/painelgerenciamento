import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Eye } from 'lucide-react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { Aviso, Titulo } from '@/components/ui';
import { PaginaDoMaterial } from '@/components/pagina-do-material';
import { rotas } from '@/lib/links-internos';
import type { Material } from '@/lib/tipos-banco';

export const metadata: Metadata = { title: 'Prévia do material' };
export const dynamic = 'force-dynamic';

/**
 * "Ver como a pessoa vê."
 *
 * ⚠️ Existe porque não havia outro jeito de conferir a página do material sem
 * abrir o link de um contato de verdade — e abrir o link de um contato REGISTRA
 * um clique no nome dele. O clique é a única métrica que o projeto controla e é
 * a prova de que a pessoa abriu o que recebeu; o gestor conferindo o próprio
 * trabalho a envenenava sem ter como saber.
 *
 * Duas diferenças para a página real, e as duas de propósito:
 *
 *   • cada peça aponta para a URL DIRETA, sem passar por `/r/{token}`. É o que
 *     faz esta tela não contar clique nenhum;
 *   • o botão de sair da lista aparece, porque a pessoa o vê, mas não faz nada.
 *
 * Todo o resto — inclusive o "ainda não está no ar" de quem não tem peça — é o
 * mesmo componente da página real. Prévia que diverge do que a pessoa recebe é
 * pior que prévia nenhuma.
 */
export default async function PaginaPrevia({
  params,
}: {
  params: Promise<{ entrada: string; id: string }>;
}) {
  const { entrada, id } = await params;
  const r = rotas(entrada);
  const supabase = await criarClienteServidor();

  const [{ data: candidato }, { data: materiais }] = await Promise.all([
    supabase
      .from('candidatos')
      // Numa linha só, sem concatenar: o PostgREST tipa a resposta a partir do
      // literal, e a soma de dois pedaços apaga essa inferência.
      .select('nome_urna, cargo, numero, partido_sigla, coligacao, cnpj_campanha, responsavel_material, slogan, chamada, propostas')
      .eq('id', id)
      .maybeSingle(),
    supabase
      .from('materiais')
      .select('*')
      .eq('candidato_id', id)
      .eq('ativo', true)
      .order('ordem'),
  ]);

  if (!candidato) notFound();
  const pecas = (materiais ?? []) as Material[];

  return (
    <>
      <Link href={r.gestorCandidato(id)}
            className="mb-5 inline-flex items-center gap-1.5 text-sm text-suave transition-colors hover:text-texto">
        <ArrowLeft size={15} /> Voltar para o candidato
      </Link>

      <Titulo sub="É isto que a pessoa abre quando clica no link que o atendente manda pelo WhatsApp — depois de ela ter autorizado.">
        Prévia do material
      </Titulo>

      <Aviso tom="info" icone={<Eye size={16} />} className="mb-5">
        <p>
          <strong className="text-texto">Nada aqui conta como clique.</strong> As peças abrem
          direto, em outra aba, sem passar pelo contador — por isso esta tela existe: abrir o link
          de um contato de verdade para conferir registraria um clique no nome dele, e o clique é
          a métrica mais confiável da campanha.
        </p>
        <p className="mt-2">
          O botão de sair da lista aparece porque a pessoa o vê, mas aqui não faz nada. E as cores
          seguem a preferência do aparelho de quem abre: no celular da pessoa isto pode aparecer
          claro.
        </p>
      </Aviso>

      {/* `publico` troca a paleta para a das telas de fora — é a mesma classe
          que o layout público usa. Sem ela, a prévia sairia escura sempre, e o
          gestor conferiria uma página que a maioria das pessoas não vê assim. */}
      <div className="publico rounded-3xl border border-borda bg-fundo p-4 text-texto sm:p-8">
        <div className="mx-auto w-full max-w-xl">
          <PaginaDoMaterial
            candidato={candidato}
            abrirEmNovaAba
            pecas={pecas.map((m) => ({
              chave: m.id,
              titulo: m.titulo,
              descricao: m.descricao,
              tipo: m.tipo,
              // A URL crua da peça: é o que mantém a prévia fora da contagem.
              href: m.url,
            }))}
            saida={
              <span className="text-sm text-suave underline underline-offset-4">
                Não quero mais receber mensagens
              </span>
            }
          />
        </div>
      </div>
    </>
  );
}
