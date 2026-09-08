import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { unstable_cache } from 'next/cache';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { buscarCandidatoPublico, type CandidatoPublico } from '@/lib/candidato-publico';
import { enderecoDaVisita } from '@/lib/dominios-candidatos';
import { LADO_ICONE, TAMANHO_CARTAO, versaoDaMarca } from '@/lib/marca';
import { Cartao, cx } from '@/components/ui';
import { textoDoAceite } from '@/lib/consentimento';
import { ROTULO_CARGO, type CargoEleitoral, type Municipio } from '@/lib/tipos-banco';
import { comAlfa, contrasta, degrau, mistura } from '@/lib/cores';
import { carregarItensKit } from '@/lib/acoes-itens-kit';
import { comitesDoCandidato } from '@/lib/acoes-comites';
import { FormularioCandidato } from './formulario';

/**
 * A página pública de um candidato, sem saber por qual endereço chegou.
 *
 * Ela responde em DOIS lugares e é a mesma nos dois:
 *   • `/{slug}` no endereço da Vercel — sempre, para sempre;
 *   • a raiz do domínio próprio do candidato, quando ele tem um.
 *
 * ⚠️ Por isso ela mora aqui e não num `page.tsx`: rota do Next recebe
 * `params`, e a raiz de um domínio próprio não tem parâmetro nenhum na URL —
 * quem diz de quem é a página é o cabeçalho `Host`. Duplicar o conteúdo nas
 * duas rotas seria garantir que um dia elas divergissem, e a que ficaria para
 * trás é justamente a que o eleitor abre.
 */

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
 * O título, a descrição, o ícone da aba e a imagem que o WhatsApp mostra.
 *
 * Nada aqui pode citar painel, atendimento, lead ou campanha interna: quem abre
 * o código-fonte tem de ver uma página de pedir material e mais nada. É por
 * isso que o layout raiz tem metadado neutro — quando esta página esquecer de
 * sobrescrever alguma coisa, o que herda não denuncia nada.
 *
 * ⚠️ O ícone e o cartão saem no endereço DESTA visita, não num endereço fixo.
 * A mesma página responde no endereço da Vercel e no domínio próprio da
 * campanha, e as duas imagens seguem o mesmo corte do resto: quem tem domínio
 * conferido não tem mais nada respondendo no endereço antigo. Apontar para um
 * host fixo faria o WhatsApp buscar a imagem justamente onde ela é 404.
 *
 * ⚠️ E `?v=` não é enfeite: o WhatsApp guarda a prévia por URL e não pergunta
 * de novo. Sem o carimbo, trocar a logo em Candidatos não mudaria nada em
 * aparelho nenhum, e o gestor mexeria no campo achando que não salva.
 */
export async function metadadosDoCandidato(slug: string): Promise<Metadata> {
  const c = await buscarCandidatoPublico(slug);
  if (!c?.ativo) return { title: 'Material da campanha' };

  const base = await enderecoDaVisita();
  const marca = (peca: 'cartao' | 'icone') =>
    `${base ?? ''}/api/marca/${c.slug}/${peca}?v=${versaoDaMarca(c)}`;

  const titulo = `Material de ${c.nome_urna}`;
  const descricao = `Peça o material da campanha de ${c.nome_urna} pelo WhatsApp.`;

  return {
    title: titulo,
    description: descricao,
    robots: { index: false, follow: false },
    icons: {
      icon: [{ url: marca('icone'), type: 'image/png', sizes: `${LADO_ICONE}x${LADO_ICONE}` }],
      shortcut: [{ url: marca('icone'), type: 'image/png' }],
      apple: [{ url: marca('icone'), type: 'image/png', sizes: '180x180' }],
    },
    openGraph: {
      type: 'website',
      locale: 'pt_BR',
      siteName: c.nome_urna,
      title: titulo,
      description: descricao,
      ...(base ? { url: base } : {}),
      images: [{ ...TAMANHO_CARTAO, url: marca('cartao'), alt: titulo, type: 'image/png' }],
    },
    twitter: {
      card: 'summary_large_image',
      title: titulo,
      description: descricao,
      images: [marca('cartao')],
    },
  };
}

export async function PaginaPublicaDoCandidato({ slug }: { slug: string }) {
  const candidato = await buscarCandidatoPublico(slug);

  // Endereço que não é de candidato ativo devolve 404 — a MESMA resposta que a
  // chave errada do painel e que qualquer endereço inexistente. De fora não dá
  // para separar as três.
  if (!candidato?.ativo) notFound();

  const [municipios, itensKit, comites] = await Promise.all([
    municipiosDeRondonia(),
    // Sem cache: o gestor acabou de acrescentar "boné" e precisa ver na página
    // agora, não daqui a uma hora. É uma consulta a uma tabela de três linhas.
    carregarItensKit(),
    // Onde buscar material perto de casa. Só deste candidato: a página de um
    // não anuncia o comitê de outro.
    comitesDoCandidato(candidato.id),
  ]);
  const aceite = textoDoAceite(candidato);

  return (
    <div className="surgir flex min-h-screen flex-col">
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
          itensKit={itensKit}
          comites={comites}
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
    </div>
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
