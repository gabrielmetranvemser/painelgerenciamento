import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { ID_DA_EXTENSAO } from './whatsapp-aba';

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
