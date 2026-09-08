import 'server-only';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ImageResponse } from 'next/og';
import {
  LADO_ICONE, TAMANHO_CARTAO, iniciais, linhaDeCima, paleta,
  type CandidatoDaMarca,
} from '@/lib/marca';

/**
 * O desenho do ícone e do cartão de compartilhamento.
 *
 * Separado de `marca.ts` porque só as duas rotas de imagem precisam disto: as
 * fontes são lidas do disco no carregamento do módulo, e quem só quer o carimbo
 * de versão (a prévia no painel do gestor, por exemplo) não pode pagar por
 * isso — nem depender de arquivos que só estão empacotados com aquelas rotas.
 */

/**
 * ⚠️ Lidas UMA VEZ, no carregamento do módulo, e não a cada requisição.
 *
 * O rastreador do Next não enxerga leitura por caminho — segue `import` —,
 * então `next.config.ts` empacota `src/assets/fontes` com estas rotas na mão.
 * Sem aquela linha o arquivo não sobe, e a falha aparece só em produção.
 */
const [bricolage, manrope] = await Promise.all([
  readFile(join(process.cwd(), 'src/assets/fontes/BricolageGrotesque-Bold.ttf')),
  readFile(join(process.cwd(), 'src/assets/fontes/Manrope-SemiBold.ttf')),
]);

const FONTES = [
  { name: 'Bricolage', data: bricolage, weight: 700 as const, style: 'normal' as const },
  { name: 'Manrope', data: manrope, weight: 600 as const, style: 'normal' as const },
];

/**
 * A logo, convertida para PNG e já no tamanho em que vai ser desenhada.
 *
 * ⚠️ A conversão não é capricho: o painel guarda toda imagem em WebP (é o que
 * deixa a página leve no 3G do interior), e o desenhista destas imagens não lê
 * WebP — ele falha no meio da renderização, sem mensagem que ajude. Sem este
 * passo o cartão sairia sem a logo, que é justamente o que ele existe para
 * mostrar.
 *
 * FALHA PARA O LADO DE DESENHAR ASSIM MESMO: qualquer tropeço aqui — a imagem
 * fora do ar, um formato estranho, o `sharp` ausente — devolve `null`, e as
 * imagens saem com o nome no lugar da logo. Um cartão sem logo é bem melhor
 * que um link sem prévia nenhuma.
 */
async function logoEmPng(
  url: string | null,
  caixa: { largura: number; altura: number },
): Promise<{ dados: string; largura: number; altura: number } | null> {
  if (!url) return null;

  try {
    const resposta = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    if (!resposta.ok) return null;

    const bruto = Buffer.from(await resposta.arrayBuffer());
    // Balde público: o endereço pode ter sido trocado por um arquivo enorme.
    if (bruto.length === 0 || bruto.length > 8 * 1024 * 1024) return null;

    const { default: sharp } = await import('sharp');
    const { data, info } = await sharp(bruto)
      .resize({
        width: caixa.largura,
        height: caixa.altura,
        fit: 'inside',
        // Logo pequena não é esticada: borrada fica pior que pequena.
        withoutEnlargement: true,
      })
      .png()
      .toBuffer({ resolveWithObject: true });

    return {
      dados: `data:image/png;base64,${data.toString('base64')}`,
      largura: info.width,
      altura: info.height,
    };
  } catch {
    return null;
  }
}

// ── O cartão do WhatsApp ────────────────────────────────────────────────────

/**
 * A imagem de 1200×630 que aparece na conversa.
 *
 * A composição é adaptativa por um motivo prático: quase toda logo de campanha
 * JÁ É o nome escrito. Repetir "Sofia Andrade" embaixo de uma logo que diz
 * "Sofia Andrade" é o erro clássico deste tipo de peça. Então: tem logo, a logo
 * é o nome; não tem, o nome ocupa o lugar dela.
 *
 * O número fica numa pastilha na cor de acento porque é o que o eleitor precisa
 * levar da imagem — é o que ele vai digitar na urna, e é o único dado que
 * sobrevive a olhar a conversa por dois segundos.
 */
export async function cartaoDeCompartilhamento(c: CandidatoDaMarca): Promise<ImageResponse> {
  const p = paleta(c);
  const logo = await logoEmPng(c.foto_url, { largura: 880, altura: 268 });

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'space-between',
          padding: '66px 76px 78px',
          backgroundColor: p.fundo,
          backgroundImage: `radial-gradient(900px 560px at 88% -12%, ${p.brilho}, transparent 62%)`,
          fontFamily: 'Manrope',
          color: p.texto,
        }}
      >
        <div style={{ display: 'flex', fontSize: 26, letterSpacing: 3.5, color: p.suave }}>
          {linhaDeCima(c, logo !== null)}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start' }}>
          {logo ? (
            /* eslint-disable-next-line @next/next/no-img-element -- não é DOM:
               este JSX é desenhado em PNG, `next/image` não existe aqui. */
            <img src={logo.dados} width={logo.largura} height={logo.altura} alt="" />
          ) : (
            <div
              style={{
                display: 'flex',
                fontFamily: 'Bricolage',
                fontSize: 92,
                lineHeight: 1.05,
                letterSpacing: -2,
                maxWidth: 900,
              }}
            >
              {c.nome_urna}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 28 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              padding: '16px 34px',
              borderRadius: 999,
              backgroundColor: p.acento,
              color: p.tintaAcento,
              fontFamily: 'Bricolage',
              fontSize: 46,
              letterSpacing: 1,
            }}
          >
            {c.numero}
          </div>
          <div style={{ display: 'flex', fontSize: 30, color: p.suave }}>
            Peça o material da campanha
          </div>
        </div>

        {/* A faixa é o fecho: dá base à imagem e repete o acento embaixo da
            pastilha, para o número não ser a única coisa colorida da peça. */}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: 14,
            backgroundColor: p.acento,
          }}
        />
      </div>
    ),
    { ...TAMANHO_CARTAO, fonts: FONTES },
  );
}

// ── O ícone da aba ──────────────────────────────────────────────────────────

/**
 * O ícone quadrado: aba do navegador, atalho na tela do celular, favorito.
 *
 * ⚠️ O fundo é a cor de FUNDO da campanha, nunca a de acento — por mais que o
 * acento chame mais atenção aos 16 pixels da aba. A logo foi desenhada para
 * ficar sobre o fundo do site: a da Sofia é branca, e branco sobre o amarelo
 * dela some. Ícone invisível é pior que ícone discreto.
 *
 * Quem faz o ícone ser achado numa fileira de quinze abas é a faixa de acento
 * embaixo, que é a mesma assinatura do cartão e não corre risco de sumir.
 *
 * ⚠️ Logo larga (o nome escrito, que é o caso comum) fica ilegível nesse
 * tamanho, e isso é uma limitação real do formato, não um defeito daqui: quem
 * quiser um ícone melhor sobe em Candidatos uma logo mais quadrada. Sem logo,
 * as iniciais — que aos 16 pixels leem melhor que qualquer desenho.
 */
export async function iconeDoCandidato(c: CandidatoDaMarca): Promise<ImageResponse> {
  const p = paleta(c);
  const faixa = Math.round(LADO_ICONE * 0.08);
  const logo = await logoEmPng(c.foto_url, {
    // Quase toda a largura: a logo típica é o nome escrito, e nesse tamanho
    // cada pixel de margem é uma letra a menos que dá para reconhecer.
    largura: Math.round(LADO_ICONE * 0.88),
    altura: Math.round(LADO_ICONE * 0.6),
  });

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // A faixa embaixo desloca o centro óptico para cima.
          paddingBottom: faixa,
          backgroundColor: p.fundo,
          color: p.acento,
          fontFamily: 'Bricolage',
          fontSize: 118,
          letterSpacing: -4,
        }}
      >
        {logo
          /* eslint-disable-next-line @next/next/no-img-element -- ver acima. */
          ? <img src={logo.dados} width={logo.largura} height={logo.altura} alt="" />
          : iniciais(c.nome_urna)}
        <div
          style={{
            position: 'absolute',
            left: 0,
            right: 0,
            bottom: 0,
            height: faixa,
            backgroundColor: p.acento,
          }}
        />
      </div>
    ),
    { width: LADO_ICONE, height: LADO_ICONE, fonts: FONTES },
  );
}
