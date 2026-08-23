import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { Cartao, cx } from '@/components/ui';
import { textoDoAceite } from '@/lib/consentimento';
import { ROTULO_CARGO, type CargoEleitoral, type Municipio } from '@/lib/tipos-banco';
import { FormularioCandidato } from './formulario';

export const dynamic = 'force-dynamic';

type CandidatoPublico = {
  id: string; slug: string; nome_urna: string; cargo: CargoEleitoral; numero: string;
  partido_sigla: string | null; coligacao: string | null; cnpj_campanha: string | null;
  responsavel_material: string | null; slogan: string | null; chamada: string | null;
  cor_tema: string | null; cor_fundo: string | null; foto_url: string | null;
  tema: 'auto' | 'claro' | 'escuro';
  ativo: boolean;
};

async function buscar(slug: string) {
  const supabase = criarClienteAdmin();
  const { data } = await supabase
    .from('candidatos')
    .select(
      'id, slug, nome_urna, cargo, numero, partido_sigla, coligacao, cnpj_campanha, ' +
      'responsavel_material, slogan, chamada, cor_tema, cor_fundo, foto_url, tema, ativo',
    )
    .eq('slug', slug)
    .maybeSingle();
  return (data as CandidatoPublico | null) ?? null;
}

/**
 * O título e a descrição saem do próprio candidato.
 *
 * Nada aqui pode citar painel, atendimento, lead ou campanha interna: quem abre
 * o código-fonte tem de ver uma página de pedir material e mais nada. É por
 * isso que o layout raiz tem metadado neutro — quando esta página esquecer de
 * sobrescrever alguma coisa, o que herda não denuncia nada.
 */
export async function generateMetadata({
  params,
}: {
  params: Promise<{ entrada: string }>;
}): Promise<Metadata> {
  const { entrada } = await params;
  const c = await buscar(entrada);
  if (!c?.ativo) return { title: 'Material da campanha' };
  return {
    title: `Material de ${c.nome_urna}`,
    description: `Peça o material da campanha de ${c.nome_urna} pelo WhatsApp.`,
    robots: { index: false, follow: false },
  };
}

export default async function PaginaDoCandidato({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const candidato = await buscar(entrada);

  // Endereço que não é de candidato ativo devolve 404 — a MESMA resposta que a
  // chave errada do painel e que qualquer endereço inexistente. De fora não dá
  // para separar as três.
  if (!candidato?.ativo) notFound();

  const supabase = criarClienteAdmin();
  const { data: municipios } = await supabase.from('municipios').select('*').order('nome');

  const aceite = textoDoAceite(candidato);

  return (
    <main
      className={cx(
        'publico flex min-h-screen w-full flex-1 flex-col items-center px-4 py-10 text-texto sm:px-6',
        candidato.tema === 'claro' && 'tema-claro',
        candidato.tema === 'escuro' && 'tema-escuro',
      )}
      style={estiloDoCandidato(candidato)}
    >
      <div className="w-full max-w-lg">
      <header className="mb-6 text-center">
        {candidato.foto_url && (
          // Imagem de fora, endereço que o gestor digita: <img> comum. O
          // otimizador do Next exigiria domínio configurado, e cada campanha
          // hospeda a logo onde quiser.
          // eslint-disable-next-line @next/next/no-img-element
          <img src={candidato.foto_url} alt={candidato.nome_urna}
               className="mx-auto mb-4 h-16 w-auto max-w-[70%] object-contain" />
        )}
        <p className="text-sm text-suave">
          {ROTULO_CARGO[candidato.cargo]} · nº {candidato.numero}
          {candidato.partido_sigla && ` · ${candidato.partido_sigla}`}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">
          {candidato.nome_urna}
        </h1>
        {candidato.slogan && <p className="mt-1 text-[15px] text-suave">{candidato.slogan}</p>}
        <p className="mt-4 text-[15px] leading-relaxed text-suave">
          {candidato.chamada ??
            'Deixe seu contato para receber o material da campanha pelo WhatsApp. ' +
            'Quem fala com você é uma pessoa da equipe — sem robô e sem lista de transmissão.'}
        </p>
      </header>

      <Cartao className="p-7" elevado>
        <FormularioCandidato
          slug={candidato.slug}
          aceite={aceite}
          municipios={(municipios ?? []) as Municipio[]}
        />
      </Cartao>

      <div className="mt-6 space-y-2 text-center">
        <p className="text-xs leading-relaxed text-suave">
          Propaganda eleitoral de {candidato.nome_urna}
          {candidato.partido_sigla && ` — ${candidato.partido_sigla}`}
          {candidato.coligacao && ` (${candidato.coligacao})`}
          {candidato.cnpj_campanha && ` · CNPJ ${candidato.cnpj_campanha}`}
          {candidato.responsavel_material && ` · Responsável: ${candidato.responsavel_material}`}
        </p>
        <p className="text-xs leading-relaxed text-suave">
          Seus dados são usados só para este contato de campanha e não são vendidos nem cedidos.{' '}
          <Link href="/privacidade" className="underline underline-offset-4">
            Como tratamos seus dados
          </Link>
          .
        </p>
      </div>
      </div>
    </main>
  );
}


/**
 * A identidade do candidato, aplicada por variáveis CSS.
 *
 * Vai em `style` e não em classe do Tailwind porque a cor é escolhida em
 * runtime pelo gestor: a varredura do Tailwind só enxerga nome literal, e uma
 * classe montada por interpolação não chega a existir no CSS.
 *
 * `--acento` e `--tinta-acento` são os mesmos tokens que os componentes já
 * usam, então redefini-los aqui pinta botão, foco e destaque de uma vez — sem
 * um segundo sistema de cor convivendo com o primeiro.
 */
function estiloDoCandidato(c: CandidatoPublico): React.CSSProperties {
  const estilo: Record<string, string> = {};
  if (c.cor_tema) {
    estilo['--acento'] = c.cor_tema;
    estilo['--acento-alto'] = c.cor_tema;
    estilo['--tinta-acento'] = contrasta(c.cor_tema);
  }
  if (c.cor_fundo) estilo['--fundo'] = c.cor_fundo;
  return estilo as React.CSSProperties;
}

/**
 * Preto ou branco por cima de uma cor, pelo brilho percebido.
 *
 * Luminância relativa, não média dos canais: o olho enxerga o verde muito mais
 * que o azul, e a média escolheria branco sobre amarelo — botão ilegível.
 */
function contrasta(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 150 ? '#111111' : '#ffffff';
}
