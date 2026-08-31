import 'server-only';
import JSZip from 'jszip';
import { readdir, readFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';
import { chavePainel } from '@/lib/rotas';
import { enderecoBase } from '@/lib/endereco';

/**
 * Monta o pacote da extensão, na hora do download.
 *
 * ⚠️ Antes isto era um script de `prebuild` que escrevia o zip em `public/`.
 * Não funcionou em produção: `public/` vai VAZIA para o repositório (o zip é
 * ignorado, por levar o endereço secreto dentro), e um arquivo criado durante o
 * build não entra no que a Vercel serve como estático. Resultado: o botão da
 * página /instalar caía em 404, e só dava para descobrir clicando.
 *
 * Gerar na hora resolve três coisas de uma vez:
 *
 *   1. não depende de ordem de script nem do comando de build da hospedagem
 *   2. o `config.js` sai sempre com o endereço e a chave ATUAIS — trocar a
 *      chave deixa de exigir lembrar de reempacotar
 *   3. a verificação de sessão fica na rota, não num nome de arquivo difícil
 *      de adivinhar. Arquivo em `public/` é servido pela CDN, e CDN não sabe
 *      quem está logado.
 */
const ORIGEM = 'extensao';

/**
 * Data fixa em toda entrada do zip.
 *
 * Sem isso o carimbo é "agora", e o mesmo conteúdo gera arquivos com bytes
 * diferentes a cada download — o atendente baixa de novo e não tem como saber
 * se mudou alguma coisa de verdade.
 *
 * (O script antigo passava isto para `generateAsync`, onde a opção não existe.
 * Era `.mjs` sem tipos, então ninguém reclamou e nunca funcionou.)
 */
const DATA_FIXA = new Date('2026-01-01T00:00:00Z');

export async function pacoteDaExtensao(): Promise<{ nome: string; bytes: Buffer }> {
  const chave = chavePainel();
  const base = enderecoBase();
  if (!base) {
    throw new Error(
      'Sem endereço público configurado: o config.js da extensão apontaria para lugar nenhum.',
    );
  }
  const painelUrl = `${base}/${chave}/painel`;

  const zip = new JSZip();
  const raiz = join(process.cwd(), ORIGEM);

  let lista: string[];
  try {
    lista = await arquivos(raiz);
  } catch {
    // Acontece se a pasta não for empacotada junto com a função. O rastreador
    // do Next segue `import`, e aqui a leitura é por caminho — quem garante é
    // o `outputFileTracingIncludes` do next.config.ts. Erro claro, porque o
    // sintoma seria "o download não funciona" e mais nada.
    throw new Error(
      `A pasta ${ORIGEM}/ não chegou ao servidor (${raiz}). ` +
        'Confira outputFileTracingIncludes em next.config.ts.',
    );
  }
  if (lista.length === 0) {
    throw new Error(`A pasta ${ORIGEM}/ chegou vazia — não há o que empacotar.`);
  }

  for (const caminho of lista) {
    const nome = relative(raiz, caminho).split(sep).join('/');
    // config.js e o LEIA-ME são gerados/omitidos abaixo; o manifest é reescrito.
    if (nome === 'config.js' || nome === 'LEIA-ME.md' || nome === 'manifest.json') continue;
    zip.file(nome, await readFile(caminho), { date: DATA_FIXA });
  }

  /**
   * O manifest sai com o endereço REAL do painel em `externally_connectable`.
   *
   * ⚠️ Sem isso a extensão não conversa com o painel, e o reaproveitamento da
   * aba do WhatsApp não funciona. O Chrome só expõe `chrome.runtime` a uma
   * página quando alguma extensão instalada declara aquela ORIGEM aqui — e a
   * origem do painel varia por instalação, então ela não pode estar fixa no
   * arquivo do repositório.
   *
   * A entrada é a ORIGEM com `/*`, e não o caminho do painel: `matches` do
   * `externally_connectable` não aceita caminho com segmento variável, e o que
   * está sendo autorizado é "esta página pode pedir para abrir uma aba de
   * WhatsApp" — nada que dependa do caminho. O segmento secreto continua fora
   * do arquivo.
   */
  const manifest = JSON.parse(await readFile(join(raiz, 'manifest.json'), 'utf8'));
  manifest.externally_connectable = { matches: [`${new URL(base).origin}/*`] };
  zip.file('manifest.json', JSON.stringify(manifest, null, 2) + '\n', { date: DATA_FIXA });

  zip.file(
    'config.js',
    `// Gerado no download. Não edite à mão — baixe o arquivo de novo.\n` +
      `globalThis.PAINEL_URL = ${JSON.stringify(painelUrl)};\n`,
    { date: DATA_FIXA },
  );

  zip.file('COMO-INSTALAR.txt', instrucoes(painelUrl), { date: DATA_FIXA });

  const bytes = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });

  return { nome: `painel-extensao.zip`, bytes };
}

async function arquivos(dir: string): Promise<string[]> {
  const saida: string[] = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const caminho = join(dir, item.name);
    if (item.isDirectory()) saida.push(...(await arquivos(caminho)));
    else saida.push(caminho);
  }
  return saida;
}

function instrucoes(painelUrl: string): string {
  return `PAINEL DE ATENDIMENTO — extensão do Chrome

1. Descompacte esta pasta num lugar que não vá mexer depois.
   O Chrome lê os arquivos daqui toda vez que abre; se a pasta sumir,
   a extensão para de funcionar.

2. Abra:  chrome://extensions

3. Ligue "Modo do desenvolvedor" (canto superior direito).

4. Clique em "Carregar sem compactação" e escolha a pasta descompactada.

5. Fixe o ícone na barra e clique nele para abrir o painel na lateral.

6. Deixe o WhatsApp Web aberto numa aba. A partir daí, toda conversa que
   você abrir pelo painel usa ESSA aba — não abre mais uma aba nova a cada
   contato.

   (A extensão só troca o endereço da aba. Ela não lê, não clica e não envia
   nada por você: quem revisa e aperta enviar continua sendo você.)

IMPORTANTE: extensão no Chrome é por PERFIL. Se você tem dois perfis
(um para cada número), repita os passos 2 a 5 em cada um.

Este arquivo contém o endereço do painel. Não repasse para fora da equipe.

Painel: ${painelUrl}
`;
}
