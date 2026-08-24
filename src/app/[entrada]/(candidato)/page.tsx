import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { ETIQUETA_CANDIDATOS } from '@/lib/cache';
import { Cartao, cx } from '@/components/ui';
import { textoDoAceite } from '@/lib/consentimento';
import { ROTULO_CARGO, type CargoEleitoral, type Municipio } from '@/lib/tipos-banco';
import { FormularioCandidato } from './formulario';

export const dynamic = 'force-dynamic';

type CandidatoPublico = {
  id: string; slug: string; nome_urna: string; cargo: CargoEleitoral; numero: string;
  partido_sigla: string | null; coligacao: string | null; cnpj_campanha: string | null;
  responsavel_material: string | null; slogan: string | null; chamada: string | null;
  cor_tema: string | null; cor_fundo: string | null; cor_superficie: string | null;
  foto_url: string | null; fundo_url: string | null;
  tema: 'auto' | 'claro' | 'escuro';
  ativo: boolean;
};

/**
 * ⚠️ Esta é a página mais aberta do sistema: qualquer pessoa da internet a
 * abre, ela não tem login e é o destino do botão no site de cada candidato.
 *
 * Antes, cada visita disparava DUAS consultas com a chave de serviço — a do
 * candidato e a lista inteira dos 52 municípios, que não muda nunca. Numa
 * enxurrada de acessos (ou num ataque barato de recarregar a página), isso
 * esgota a conexão do banco e derruba junto o painel de quem está trabalhando.
 *
 * O cache é de DADOS, não de página: a página continua dinâmica, o que deixa de
 * ir ao banco é a consulta. Um minuto é o bastante para segurar rajada e curto
 * o bastante para o gestor ver a edição dele quase na hora — e as ações de
 * Candidatos invalidam a etiqueta na hora em que salvam, então nem esse minuto
 * costuma existir.
 */
const buscar = unstable_cache(
  async (slug: string) => {
    const supabase = criarClienteAdmin();
    const { data } = await supabase
      .from('candidatos')
      .select(
        'id, slug, nome_urna, cargo, numero, partido_sigla, coligacao, cnpj_campanha, ' +
        'responsavel_material, slogan, chamada, cor_tema, cor_fundo, cor_superficie, ' +
        'foto_url, fundo_url, tema, ativo',
      )
      .eq('slug', slug)
      .maybeSingle();
    return (data as CandidatoPublico | null) ?? null;
  },
  ['candidato-publico'],
  { revalidate: 60, tags: [ETIQUETA_CANDIDATOS] },
);

/** Os 52 municípios de Rondônia. Lista fechada: só muda por migration. */
const municipiosDeRondonia = unstable_cache(
  async () => {
    const supabase = criarClienteAdmin();
    const { data } = await supabase.from('municipios').select('*').order('nome');
    return (data ?? []) as Municipio[];
  },
  ['municipios'],
  { revalidate: 86_400 },
);

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

  const municipios = await municipiosDeRondonia();
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
          municipios={municipios}
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

  if (c.cor_fundo) {
    estilo['--fundo'] = c.cor_fundo;
    // O gradiente de acento do sistema por cima de uma cor escolhida pela
    // campanha embaralha as duas. Quem escolheu o fundo quer aquele fundo.
    estilo.backgroundImage = 'none';
    estilo.backgroundColor = c.cor_fundo;
  }

  // A cor fica por baixo da imagem: é o que a pessoa vê enquanto ela carrega, e
  // é o que sobra se a imagem falhar.
  //
  // O enquadramento vai INLINE, não em classe do Tailwind. A regra `.publico`
  // usa o atalho `background:`, que zera tamanho e repetição, e por estar fora
  // de `@layer` ela vence qualquer utilitário — o resultado era a imagem
  // repetida em ladrilho no tamanho original.
  if (c.fundo_url) {
    // Véu por cima da imagem.
    //
    // O texto do cabeçalho fica direto sobre a foto, e foto é imprevisível: um
    // céu claro no lugar errado apaga a linha do cargo e do número. O véu sai
    // da cor de fundo escolhida, então continua parecendo a identidade da
    // campanha — só que legível em qualquer imagem.
    const veu = comAlfa(c.cor_fundo ?? (c.tema === 'claro' ? '#f4f4f3' : '#08090b'), 0.55);
    estilo.backgroundImage = `linear-gradient(${veu}, ${veu}), url(${c.fundo_url})`;
    estilo.backgroundSize = 'cover';
    estilo.backgroundPosition = 'center';
    estilo.backgroundRepeat = 'no-repeat';
    estilo.backgroundAttachment = 'scroll';
  }

  if (c.cor_superficie) {
    const s = c.cor_superficie;
    const texto = contrasta(s);
    estilo['--superficie'] = s;
    // O campo é o cartão com UM passo de contraste, derivado — não um segundo
    // seletor. Duas cores que precisam combinar, escolhidas à mão, combinam
    // até alguém mexer numa só.
    estilo['--superficie-alta'] = degrau(s);
    estilo['--borda'] = mistura(texto, s, 0.14);
    estilo['--borda-forte'] = mistura(texto, s, 0.28);
    estilo['--texto'] = texto;
    estilo['--suave'] = mistura(texto, s, 0.45);
    estilo['--tenue'] = mistura(texto, s, 0.3);
  }

  return estilo as React.CSSProperties;
}

/**
 * Preto ou branco por cima de uma cor, pelo brilho percebido.
 *
 * Luminância relativa, não média dos canais: o olho enxerga o verde muito mais
 * que o azul, e a média escolheria branco sobre amarelo — botão ilegível.
 */
function contrasta(hex: string): string {
  return luminancia(hex) > 0.42 ? '#111111' : '#ffffff';
}

function luminancia(hex: string): number {
  const c = canais(hex).map((v) => {
    const n = v / 255;
    return n <= 0.03928 ? n / 12.92 : ((n + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}

function canais(hex: string): number[] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Mistura duas cores. `p` é quanto de `a` entra. */
function mistura(a: string, b: string, p: number): string {
  const [x, y] = [canais(a), canais(b)];
  const n = x.map((v, i) => Math.round(v * p + y[i] * (1 - p)));
  return `#${n.map((v) => Math.max(0, Math.min(255, v)).toString(16).padStart(2, '0')).join('')}`;
}

/** A mesma cor, com transparência. */
function comAlfa(hex: string, alfa: number): string {
  const [r, g, b] = canais(hex);
  return `rgba(${r}, ${g}, ${b}, ${alfa})`;
}

/** Um passo de contraste: clareia cor escura, escurece cor clara. */
function degrau(hex: string): string {
  return mistura(luminancia(hex) > 0.42 ? '#000000' : '#ffffff', hex, 0.06);
}
