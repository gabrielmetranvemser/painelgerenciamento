import { beforeEach, describe, expect, it } from 'vitest';
import {
  assinarAparelho, gerarCodigo, hashDoCodigo, lerAparelho, VALIDADE_DIAS,
} from './aparelho';

const ID = '11111111-2222-3333-4444-555555555555';
const AGORA = 1_800_000_000_000;

beforeEach(() => { process.env.HMAC_SECRET = 'segredo-de-teste'; });

describe('a marca do aparelho', () => {
  it('1. o que foi assinado é lido de volta', async () => {
    const c = await assinarAparelho(ID, AGORA);
    expect(await lerAparelho(c, AGORA)).toBe(ID);
  });

  // ⚠️ A razão de a marca ser assinada. Sem isto, qualquer pessoa que
  // descobrisse o formato escreveria o cookie à mão e entraria.
  it('2. cookie adulterado é recusado', async () => {
    const c = await assinarAparelho(ID, AGORA);
    const [id, ts, sig] = c.split('.');
    expect(await lerAparelho(`outro-id.${ts}.${sig}`, AGORA)).toBeNull();
    expect(await lerAparelho(`${id}.${ts}.${sig.slice(0, -1)}x`, AGORA)).toBeNull();
    expect(await lerAparelho(`${id}.${Number(ts) + 1}.${sig}`, AGORA)).toBeNull();
  });

  it('3. outro segredo não abre a porta', async () => {
    const c = await assinarAparelho(ID, AGORA);
    process.env.HMAC_SECRET = 'outro-segredo';
    expect(await lerAparelho(c, AGORA)).toBeNull();
  });

  it('4. vence depois de um ano', async () => {
    const c = await assinarAparelho(ID, AGORA);
    const umAno = VALIDADE_DIAS * 86_400_000;
    expect(await lerAparelho(c, AGORA + umAno - 1000)).toBe(ID);
    expect(await lerAparelho(c, AGORA + umAno + 1000)).toBeNull();
  });

  // Relógio do cliente adiantado não estica a validade.
  it('5. data no futuro é recusada', async () => {
    const c = await assinarAparelho(ID, AGORA + 5 * 86_400_000);
    expect(await lerAparelho(c, AGORA)).toBeNull();
  });

  it('6. lixo devolve null, nunca erro', async () => {
    for (const v of [null, undefined, '', 'x', 'a.b', 'a.b.c.d', 'a.naonumero.c']) {
      expect(await lerAparelho(v, AGORA)).toBeNull();
    }
  });
});

describe('o convite', () => {
  it('7. cada código é diferente e não é curto', () => {
    const a = gerarCodigo();
    expect(a).not.toBe(gerarCodigo());
    expect(a.length).toBeGreaterThanOrEqual(26);
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it('8. o banco guarda o hash, nunca o código', async () => {
    const c = gerarCodigo();
    const h = await hashDoCodigo(c);
    expect(h).not.toContain(c);
    expect(await hashDoCodigo(c)).toBe(h);
    expect(await hashDoCodigo(`${c}x`)).not.toBe(h);
  });
});
