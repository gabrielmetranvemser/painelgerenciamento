/**
 * Converte um arquivo de imagem em WebP, no navegador.
 *
 * A conversão acontece aqui, e não no servidor, por três motivos: o que sobe
 * pela rede já é o arquivo pequeno (foto de celular tem 4 MB e vira ~120 KB),
 * não é preciso `sharp` no pacote da função, e o gestor vê a prévia do
 * resultado antes de gravar.
 *
 * `imageOrientation: 'from-image'` não é detalhe: sem isso, foto tirada com o
 * celular deitado sobe girada 90°. O EXIF morre no canvas, então a rotação
 * precisa ser aplicada na decodificação.
 */

export type ImagemPronta = { arquivo: File; largura: number; altura: number; bytes: number };

export class ErroImagem extends Error {}

const TIPOS_ACEITOS = ['image/jpeg', 'image/png', 'image/webp', 'image/avif', 'image/gif'];

/** 8 MB de entrada: acima disso é imagem de câmera profissional, não logo. */
const ENTRADA_MAXIMA = 8 * 1024 * 1024;

/** 2 MB de saída — o mesmo teto do balde no Supabase. */
const SAIDA_MAXIMA = 2 * 1024 * 1024;

export async function paraWebp(
  arquivo: File,
  { ladoMaximo, qualidade = 0.82, nome }: { ladoMaximo: number; qualidade?: number; nome: string },
): Promise<ImagemPronta> {
  if (!TIPOS_ACEITOS.includes(arquivo.type)) {
    throw new ErroImagem(
      'Formato não aceito. Use JPG, PNG, WebP, AVIF ou GIF. ' +
      'Se a foto veio do iPhone em HEIC, exporte como JPG antes.',
    );
  }
  if (arquivo.size > ENTRADA_MAXIMA) {
    throw new ErroImagem(`A imagem tem ${(arquivo.size / 1048576).toFixed(1)} MB. O limite é 8 MB.`);
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(arquivo, { imageOrientation: 'from-image' });
  } catch {
    throw new ErroImagem('Não consegui abrir esta imagem. O arquivo pode estar corrompido.');
  }

  // Só reduz. Ampliar uma logo pequena não acrescenta detalhe nenhum e ainda
  // multiplica o peso do arquivo.
  const escala = Math.min(1, ladoMaximo / Math.max(bitmap.width, bitmap.height));
  const largura = Math.max(1, Math.round(bitmap.width * escala));
  const altura = Math.max(1, Math.round(bitmap.height * escala));

  const tela = document.createElement('canvas');
  tela.width = largura;
  tela.height = altura;
  const ctx = tela.getContext('2d');
  if (!ctx) throw new ErroImagem('O navegador não permitiu processar a imagem.');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, largura, altura);
  bitmap.close();

  const blob = await new Promise<Blob | null>((r) => tela.toBlob(r, 'image/webp', qualidade));
  if (!blob || blob.type !== 'image/webp') {
    throw new ErroImagem('Este navegador não converte para WebP. Use Chrome, Edge, Firefox ou Safari atualizado.');
  }
  if (blob.size > SAIDA_MAXIMA) {
    throw new ErroImagem(
      `Mesmo comprimida a imagem ficou com ${(blob.size / 1048576).toFixed(1)} MB. ` +
      'Use uma imagem menor ou com menos detalhe.',
    );
  }

  return {
    arquivo: new File([blob], `${nome}.webp`, { type: 'image/webp' }),
    largura,
    altura,
    bytes: blob.size,
  };
}
