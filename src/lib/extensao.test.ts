import { beforeEach, describe, expect, it } from 'vitest';
import JSZip from 'jszip';
import { pacoteDaExtensao } from './extensao';

/**
 * O pacote da extensão.
 *
 * Este teste existe por um motivo específico: o download quebrou em produção e
 * ninguém percebeu até um atendente clicar. O zip era escrito por um script de
 * build dentro de `public/`, que vai vazia para o repositório — e arquivo criado
 * durante o build não entra no que a hospedagem serve como estático.
 *
 * Agora o pacote é montado na hora, e o que se cobre aqui é justamente o que
 * não dava para ver: ele monta, leva os arquivos certos, e o `config.js` sai
 * com o endereço e a chave DESTE ambiente.
 */
describe('pacoteDaExtensao', () => {
  beforeEach(() => {
    process.env.PAINEL_CHAVE = 'chavedetestelonga';
    process.env.LINK_BASE_URL = 'https://exemplo.com.br';
  });

  it('monta o zip com o manifesto e os arquivos da extensão', async () => {
    const { nome, bytes } = await pacoteDaExtensao();
    expect(nome).toBe('painel-extensao.zip');

    const zip = await JSZip.loadAsync(bytes);
    const dentro = Object.keys(zip.files);
    expect(dentro).toContain('manifest.json');
    expect(dentro).toContain('background.js');
    expect(dentro).toContain('sidepanel.html');
    expect(dentro).toContain('COMO-INSTALAR.txt');
  });

  it('o config.js aponta para a chave e o endereço deste ambiente', async () => {
    const { bytes } = await pacoteDaExtensao();
    const zip = await JSZip.loadAsync(bytes);
    const config = await zip.file('config.js')!.async('string');
    expect(config).toContain('https://exemplo.com.br/chavedetestelonga/painel');
  });

  // O LEIA-ME é para quem mexe no código, não para quem instala; e o config.js
  // versionado é um placeholder que sobrescreveria o gerado.
  it('não leva o LEIA-ME nem o config.js versionado', async () => {
    const { bytes } = await pacoteDaExtensao();
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files)).not.toContain('LEIA-ME.md');
    const config = await zip.file('config.js')!.async('string');
    expect(config).toContain('Gerado no download');
  });

  // Mesma entrada, mesmo arquivo: baixar duas vezes não pode render bytes
  // diferentes, senão não dá para saber se mudou alguma coisa de verdade.
  it('gera bytes idênticos a cada chamada', async () => {
    const a = await pacoteDaExtensao();
    const b = await pacoteDaExtensao();
    expect(a.bytes.equals(b.bytes)).toBe(true);
  });

  // Sem endereço, o config.js apontaria para lugar nenhum e a extensão
  // instalaria quebrada em quinze máquinas antes de alguém notar.
  it('recusa montar sem endereço configurado', async () => {
    delete process.env.LINK_BASE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    await expect(pacoteDaExtensao()).rejects.toThrow(/endereço/i);
  });
});
