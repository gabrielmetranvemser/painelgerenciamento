import { comAlfa, contrasta, ehClara, mistura } from '@/lib/cores';
import { ROTULO_CARGO, type CargoEleitoral } from '@/lib/tipos-banco';

/**
 * A cara do candidato fora do site: o ícone da aba e a imagem que o WhatsApp
 * mostra quando alguém cola o link.
 *
 * ⚠️ Isto NÃO é enfeite. O link da página de captação é colado em conversa de
 * WhatsApp o dia inteiro, e o que o aplicativo desenha ali é o cartão de visita
 * da campanha. Enquanto não existia `og:image`, o WhatsApp caía no favicon
 * padrão do Next — o triângulo preto do framework — e o material da campanha
 * chegava ao eleitor com a marca de uma empresa de hospedagem americana.
 *
 * Aqui ficam os FATOS: a paleta, o carimbo de versão e o que cada linha de
 * texto diz. O desenho em si mora em `marca-imagens.tsx`, que é `server-only`
 * e carrega as fontes — o painel do gestor precisa do carimbo para montar a
 * prévia, e não tem por que arrastar o desenhista de imagem junto.
 *
 * As duas imagens são GERADAS a partir do que o gestor já edita em Candidatos:
 * a logo, as cores, o nome, o cargo e o número. Não há um segundo lugar para
 * manter — trocar a logo troca o ícone e o cartão junto, e é por isso que a
 * versão (`versaoDaMarca`) entra na URL: sem ela o WhatsApp continuaria
 * servindo para sempre a imagem que baixou da primeira vez.
 */

export type CandidatoDaMarca = {
  slug: string;
  nome_urna: string;
  cargo: CargoEleitoral;
  numero: string;
  partido_sigla: string | null;
  coligacao: string | null;
  cor_tema: string | null;
  cor_fundo: string | null;
  foto_url: string | null;
  tema: 'auto' | 'claro' | 'escuro';
};

/**
 * A paleta desta campanha, com os mesmos padrões do sistema quando o gestor não
 * escolheu nada. As contas são as de `src/lib/cores.ts`, as mesmas da página —
 * é o que garante que o cartão e o site não sejam dois verdes diferentes.
 */
export function paleta(c: CandidatoDaMarca) {
  const claro = c.tema === 'claro';
  const fundo = c.cor_fundo ?? (claro ? '#f4f4f3' : '#08090b');
  const acento = c.cor_tema ?? (ehClara(fundo) ? '#4d7c0f' : '#c6f24e');
  const texto = contrasta(fundo);

  return {
    fundo,
    acento,
    texto,
    /** Um passo abaixo do texto: o cargo e o partido não competem com a logo. */
    suave: mistura(texto, fundo, 0.6),
    tintaAcento: contrasta(acento),
    /** O mesmo brilho de acento que a página tem no canto superior. */
    brilho: comAlfa(acento, 0.18),
  };
}

/**
 * A versão da marca: muda quando muda qualquer coisa que aparece nas imagens.
 *
 * O WhatsApp guarda a prévia por URL e não pergunta de novo. Sem isto, trocar
 * a logo em Candidatos não trocaria nada no aplicativo de ninguém — e o gestor
 * ficaria mexendo num campo achando que não salva.
 *
 * Hash curto e bobo de propósito (djb2): não é assinatura, é só um carimbo que
 * muda junto com o conteúdo.
 */
export function versaoDaMarca(c: CandidatoDaMarca): string {
  const entrada = [
    c.nome_urna, c.cargo, c.numero, c.partido_sigla, c.coligacao,
    c.cor_tema, c.cor_fundo, c.foto_url, c.tema,
  ].join('|');

  let h = 5381;
  for (let i = 0; i < entrada.length; i += 1) h = ((h * 33) ^ entrada.charCodeAt(i)) >>> 0;
  return h.toString(36);
}

/** As iniciais, para quando não há logo. Duas letras no máximo. */
export function iniciais(nome: string): string {
  const partes = nome.split(/\s+/).filter((p) => /\p{L}/u.test(p[0] ?? ''));
  const letras = [partes[0], partes[1]].filter(Boolean).map((p) => p![0]!.toUpperCase());
  return letras.join('') || '?';
}

/**
 * A linha de cima do cartão, em caixa alta espaçada.
 *
 * ⚠️ Ela nunca repete o que a logo já diz. Quase toda logo de campanha traz o
 * cargo escrito — a da Sofia diz "DEPUTADA FEDERAL" em cima do nome —, e a
 * primeira versão desta imagem escrevia "DEPUTADO FEDERAL · PL" logo acima
 * disso. Duas vezes a mesma informação, e ainda com o gênero errado, porque o
 * rótulo do sistema é o do cargo e não o da pessoa.
 *
 * Então: com logo, sobra o que a logo não tem — partido e coligação. Sem logo,
 * o cargo volta, porque aí não está escrito em lugar nenhum.
 */
export function linhaDeCima(c: CandidatoDaMarca, temLogo: boolean): string {
  const partes = temLogo
    ? [c.partido_sigla, c.coligacao]
    : [ROTULO_CARGO[c.cargo], c.partido_sigla];
  return partes.filter(Boolean).join(' · ').toUpperCase();
}

export const TAMANHO_CARTAO = { width: 1200, height: 630 };
export const LADO_ICONE = 256;
