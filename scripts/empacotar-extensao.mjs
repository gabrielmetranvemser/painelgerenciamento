#!/usr/bin/env node
/**
 * Empacota a extensão em public/painel-extensao.zip, para a página /instalar
 * servir como download.
 *
 * Roda no `prebuild` e no `predev`, então o arquivo nunca fica desatualizado em
 * relação ao código — por isso ele é gerado e não versionado.
 *
 * O `config.js` é ESCRITO AQUI, com a URL do ambiente. Sem isso, alguém teria
 * que editar o arquivo à mão em quinze máquinas, e bastaria esquecer uma para
 * um atendente ficar apontando para o lugar errado sem perceber.
 */
import JSZip from 'jszip';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { join, relative } from 'node:path';
import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: '.env.local', quiet: true });

const ORIGEM = 'extensao';
const DESTINO = 'public/painel-extensao.zip';

/**
 * De onde sai a URL, em ordem de preferência:
 *
 *   PAINEL_URL                      domínio próprio, quando existir
 *   LINK_BASE_URL                   o que a aplicação já usa
 *   VERCEL_PROJECT_PRODUCTION_URL   o apelido estável do projeto
 *   VERCEL_URL                      a URL desta implantação (último recurso:
 *                                   muda a cada deploy, mas é melhor que nada)
 *
 * As duas últimas existem porque este script roda no `prebuild`: sem elas, uma
 * variável faltando no ambiente de BUILD derrubaria o deploy inteiro por causa
 * de um zip de 4 kB — foi exatamente o que aconteceu na primeira tentativa.
 */
function descobrirBase() {
  const explicito = process.env.PAINEL_URL || process.env.LINK_BASE_URL;
  if (explicito) return explicito.replace(/\/+$/, '');

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL || process.env.VERCEL_URL;
  if (vercel) return `https://${vercel.replace(/^https?:\/\//, '').replace(/\/+$/, '')}`;

  return null;
}

const base = descobrirBase();
if (!base) {
  console.error('❌ não sei o endereço do painel: defina PAINEL_URL ou LINK_BASE_URL.');
  process.exit(1);
}
const painelUrl = base.endsWith('/painel') ? base : `${base}/painel`;

async function arquivos(dir) {
  const saida = [];
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const caminho = join(dir, item.name);
    if (item.isDirectory()) saida.push(...(await arquivos(caminho)));
    else saida.push(caminho);
  }
  return saida;
}

const zip = new JSZip();

for (const caminho of await arquivos(ORIGEM)) {
  const nome = relative(ORIGEM, caminho);
  // config.js e o LEIA-ME são gerados/omitidos abaixo.
  if (nome === 'config.js' || nome === 'LEIA-ME.md') continue;
  zip.file(nome, await readFile(caminho));
}

zip.file('config.js',
`// Gerado no build. Não edite à mão: rode \`npm run extensao:pacote\` de novo.
globalThis.PAINEL_URL = ${JSON.stringify(painelUrl)};
`);

zip.file('COMO-INSTALAR.txt',
`PAINEL DE ATENDIMENTO — extensão do Chrome

1. Descompacte esta pasta num lugar que não vá mexer depois.
   O Chrome lê os arquivos daqui toda vez que abre; se a pasta sumir,
   a extensão para de funcionar.

2. Abra:  chrome://extensions

3. Ligue "Modo do desenvolvedor" (canto superior direito).

4. Clique em "Carregar sem compactação" e escolha a pasta descompactada.

5. Fixe o ícone na barra e clique nele para abrir o painel na lateral.

IMPORTANTE: extensão no Chrome é por PERFIL. Se você tem dois perfis
(um para cada número), repita os passos 2 a 5 em cada um.

Painel: ${painelUrl}
`);

await mkdir('public', { recursive: true });
const buffer = await zip.generateAsync({
  type: 'nodebuffer',
  compression: 'DEFLATE',
  // Data fixa: mesma entrada gera o mesmo arquivo, então o build não muda o
  // zip à toa a cada deploy.
  date: new Date('2026-01-01T00:00:00Z'),
});
await writeFile(DESTINO, buffer);

console.log(`✅ ${DESTINO} (${(buffer.length / 1024).toFixed(1)} kB) → ${painelUrl}`);
