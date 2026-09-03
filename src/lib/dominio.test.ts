import { describe, expect, it } from 'vitest';
import { normalizarDominio, problemaNoDominio } from './dominio';

describe('normalizarDominio', () => {
  it('deixa passar o que já está certo', () => {
    expect(normalizarDominio('material.sofiaandrade.com.br')).toBe('material.sofiaandrade.com.br');
  });

  it('tira o esquema, a barra final e o espaço do copiar-colar', () => {
    expect(normalizarDominio('  https://Material.SofiaAndrade.com.br/  '))
      .toBe('material.sofiaandrade.com.br');
    expect(normalizarDominio('//material.exemplo.com.br')).toBe('material.exemplo.com.br');
  });

  it('tira caminho, busca, âncora e porta', () => {
    expect(normalizarDominio('material.exemplo.com.br/pagina?x=1#topo')).toBe('material.exemplo.com.br');
    expect(normalizarDominio('material.exemplo.com.br:443')).toBe('material.exemplo.com.br');
  });

  it('tira o ponto final da forma absoluta', () => {
    expect(normalizarDominio('material.exemplo.com.br.')).toBe('material.exemplo.com.br');
  });

  it('devolve null quando não sobra host', () => {
    expect(normalizarDominio('')).toBeNull();
    expect(normalizarDominio('   ')).toBeNull();
    expect(normalizarDominio(null)).toBeNull();
    expect(normalizarDominio('https://')).toBeNull();
  });
});

describe('problemaNoDominio', () => {
  it('aceita subdomínio comum', () => {
    expect(problemaNoDominio('material.sofiaandrade.com.br')).toBeNull();
    expect(problemaNoDominio('material.exemplo.com')).toBeNull();
    expect(problemaNoDominio('kit-da-campanha.exemplo.com.br')).toBeNull();
  });

  // ⚠️ A regra que protege o site que já existe.
  it('recusa o domínio raiz, que é onde mora o portal do candidato', () => {
    expect(problemaNoDominio('sofiaandrade.com.br')).toBe('sem_subdominio');
    expect(problemaNoDominio('exemplo.com')).toBe('sem_subdominio');
  });

  it('recusa o que não é host', () => {
    expect(problemaNoDominio('material exemplo.com.br')).toBe('formato');
    expect(problemaNoDominio('-material.exemplo.com.br')).toBe('formato');
    expect(problemaNoDominio('material-.exemplo.com.br')).toBe('formato');
    expect(problemaNoDominio('material.exemplo.com.br/kit')).toBe('formato');
  });

  it('recusa endereço sem terminação de letras', () => {
    expect(problemaNoDominio('material.exemplo.123')).toBe('sufixo');
  });

  it('recusa o curto e o comprido demais', () => {
    expect(problemaNoDominio('a.b')).toBe('curto');
    expect(problemaNoDominio(`${'a'.repeat(63)}.${'b'.repeat(63)}.${'c'.repeat(63)}.${'d'.repeat(63)}.com.br`))
      .toBe('longo');
  });
});
