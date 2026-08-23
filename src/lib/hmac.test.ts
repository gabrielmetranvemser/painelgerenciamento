import { beforeEach, describe, expect, it, vi } from 'vitest';

const SEGREDO = 'a'.repeat(64);

async function carregar() {
  vi.resetModules();
  return import('./hmac');
}

describe('hashTelefone', () => {
  beforeEach(() => {
    process.env.HMAC_SECRET = SEGREDO;
  });

  it('é determinístico: o mesmo número sempre dá o mesmo hash', async () => {
    const { hashTelefone } = await carregar();
    expect(hashTelefone('6981234567').hash).toBe(hashTelefone('6981234567').hash);
  });

  it('números diferentes dão hashes diferentes', async () => {
    const { hashTelefone } = await carregar();
    expect(hashTelefone('6981234567').hash).not.toBe(hashTelefone('6981234568').hash);
  });

  it('devolve sha256 em hex (64 caracteres)', async () => {
    const { hashTelefone } = await carregar();
    expect(hashTelefone('6981234567').hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it('grava a versão da chave junto, para permitir rotação futura', async () => {
    const { hashTelefone, HMAC_VERSAO_ATUAL } = await carregar();
    expect(hashTelefone('6981234567').versao).toBe(HMAC_VERSAO_ATUAL);
  });

  it('o hash não vaza o número — não contém nenhum dígito dele', async () => {
    const { hashTelefone } = await carregar();
    const { hash } = hashTelefone('6981234567');
    expect(hash).not.toContain('6981234567');
    expect(hash).not.toContain('81234567');
  });

  it('trocar o segredo muda o hash (por isso não se rotaciona no meio da campanha)', async () => {
    const { hashTelefone: comA } = await carregar();
    const anterior = comA('6981234567').hash;

    process.env.HMAC_SECRET = 'b'.repeat(64);
    const { hashTelefone: comB } = await carregar();

    expect(comB('6981234567').hash).not.toBe(anterior);
  });

  it('exige chaveDedup normalizada, não o número cru da planilha', async () => {
    const { hashTelefone } = await carregar();
    for (const cru of ['(69) 98123-4567', '5569981234567', '69981234567', '', '698123456']) {
      expect(() => hashTelefone(cru)).toThrow(/chaveDedup de 10 dígitos/);
    }
  });

  it('falha alto quando a HMAC_SECRET está ausente ou curta', async () => {
    delete process.env.HMAC_SECRET;
    const { hashTelefone } = await carregar();
    expect(() => hashTelefone('6981234567')).toThrow(/HMAC_SECRET ausente/);

    process.env.HMAC_SECRET = 'curta';
    const { hashTelefone: h2 } = await carregar();
    expect(() => h2('6981234567')).toThrow(/HMAC_SECRET ausente/);
  });
});

describe('hashTelefone + normalizarTelefone', () => {
  beforeEach(() => {
    process.env.HMAC_SECRET = SEGREDO;
  });

  it('as várias grafias do mesmo número produzem o MESMO hash de bloqueio', async () => {
    const { hashTelefone } = await carregar();
    const { normalizarTelefone } = await import('./telefone');

    const grafias = [
      '+55 69 98123-4567',
      '(69) 8123-4567',
      '5569981234567',
      '069981234567',
      '6981234567',
    ];

    const hashes = new Set(
      grafias.map((g) => {
        const r = normalizarTelefone(g);
        if (!r.valido) throw new Error(`não normalizou: ${g}`);
        return hashTelefone(r.chaveDedup).hash;
      }),
    );

    // Se este teste falhar, alguém que pediu saída volta para a fila na próxima
    // importação só porque a planilha nova escreveu o número de outro jeito.
    expect(hashes.size).toBe(1);
  });
});

describe('hashesIguais', () => {
  beforeEach(() => {
    process.env.HMAC_SECRET = SEGREDO;
  });

  it('compara corretamente', async () => {
    const { hashesIguais, hashTelefone } = await carregar();
    const a = hashTelefone('6981234567').hash;
    expect(hashesIguais(a, a)).toBe(true);
    expect(hashesIguais(a, hashTelefone('6981234568').hash)).toBe(false);
    expect(hashesIguais(a, 'curto')).toBe(false);
  });
});
