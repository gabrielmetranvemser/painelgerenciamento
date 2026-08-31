import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ID_DA_EXTENSAO, VERSAO_MINIMA } from './whatsapp-aba';

/**
 * ⚠️ O id da extensão está escrito à mão em `whatsapp-aba.ts` porque a PÁGINA
 * precisa dele, e a página não tem como ler o manifest.
 *
 * Se a chave do manifest mudar e o id não, a extensão para de receber as
 * mensagens do painel — e o sintoma seria "voltou a abrir aba nova", sem erro
 * nenhum no console. Este teste é o que impede isso de passar despercebido.
 */
describe('id da extensão', () => {
  it('é o que o Chrome vai calcular a partir da chave do manifest', () => {
    const manifest = JSON.parse(readFileSync('extensao/manifest.json', 'utf8'));
    const der = Buffer.from(manifest.key, 'base64');
    const hex = createHash('sha256').update(der).digest('hex').slice(0, 32);
    // 0–f vira a–p: é assim que o Chrome monta o id.
    const esperado = [...hex].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
    expect(ID_DA_EXTENSAO).toBe(esperado);
  });

  it('a extensão só pede as permissões que precisa — nada de tocar na página', () => {
    const manifest = JSON.parse(readFileSync('extensao/manifest.json', 'utf8'));
    expect(manifest.permissions).toEqual(['sidePanel', 'tabs']);
    // `scripting` e `content_scripts` dariam acesso ao conteúdo do WhatsApp, e
    // é daí que sai automação de envio. Ver docs/01-VISAO-GERAL.md §2.
    expect(manifest.permissions).not.toContain('scripting');
    expect(manifest.content_scripts).toBeUndefined();
  });
});

/**
 * ⚠️ A extensão NÃO se atualiza sozinha — ela é carregada sem compactação, de
 * uma pasta na máquina de cada atendente. Quem detecta que a instalada está
 * velha é `VERSAO_MINIMA`, escrita à mão no cliente.
 *
 * Se alguém publicar uma versão nova da extensão e esquecer de subir a
 * `VERSAO_MINIMA` junto, o aviso de "troque a extensão" nunca aparece e metade
 * das máquinas fica para trás sem ninguém saber — que é exatamente o que
 * aconteceu com a 1.0.0.
 */
describe('versão da extensão', () => {
  it('o manifest não está atrás da versão mínima que o painel exige', () => {
    const manifest = JSON.parse(readFileSync('extensao/manifest.json', 'utf8'));
    const numero = (v: string) => v.split('.').map(Number);
    const [a1, a2, a3] = numero(manifest.version);
    const [b1, b2, b3] = numero(VERSAO_MINIMA);
    expect(a1 * 1e6 + a2 * 1e3 + a3).toBeGreaterThanOrEqual(b1 * 1e6 + b2 * 1e3 + b3);
  });

  it('a extensão responde a quem pergunta a versão', () => {
    const background = readFileSync('extensao/background.js', 'utf8');
    expect(background).toContain("mensagem.tipo === 'versao'");
    expect(background).toContain('chrome.runtime.getManifest().version');
  });
});
