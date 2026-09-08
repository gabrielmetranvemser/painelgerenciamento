import { describe, expect, it } from 'vitest';
import { comAlfa, contrasta, degrau, ehClara, luminancia, mistura } from '@/lib/cores';

describe('contraste', () => {
  it('põe tinta escura sobre amarelo', () => {
    // O caso que derrubou a média dos canais: amarelo é claro para o olho e
    // médio para a aritmética. Botão branco sobre amarelo é ilegível.
    expect(contrasta('#fde016')).toBe('#111111');
  });

  it('põe tinta clara sobre o verde escuro da campanha', () => {
    expect(contrasta('#124012')).toBe('#ffffff');
  });

  it('lê hex de três dígitos', () => {
    expect(contrasta('#fff')).toBe('#111111');
    expect(contrasta('#000')).toBe('#ffffff');
  });

  it('não explode com lixo — devolve o contraste do preto', () => {
    // Cor inválida vinda do banco não pode derrubar a página do candidato.
    expect(contrasta('não é cor')).toBe('#ffffff');
  });
});

describe('luminância', () => {
  it('vai de 0 a 1', () => {
    expect(luminancia('#000000')).toBe(0);
    expect(luminancia('#ffffff')).toBeCloseTo(1, 5);
  });

  it('enxerga o verde mais que o azul', () => {
    expect(luminancia('#00ff00')).toBeGreaterThan(luminancia('#0000ff'));
  });

  it('concorda com ehClara', () => {
    expect(ehClara('#fde016')).toBe(true);
    expect(ehClara('#124012')).toBe(false);
  });
});

describe('mistura', () => {
  it('devolve o extremo quando p é 1 ou 0', () => {
    expect(mistura('#ffffff', '#000000', 1)).toBe('#ffffff');
    expect(mistura('#ffffff', '#000000', 0)).toBe('#000000');
  });

  it('meio a meio dá o cinza do meio', () => {
    expect(mistura('#ffffff', '#000000', 0.5)).toBe('#808080');
  });
});

describe('degrau', () => {
  it('clareia cor escura e escurece cor clara', () => {
    expect(luminancia(degrau('#121316'))).toBeGreaterThan(luminancia('#121316'));
    expect(luminancia(degrau('#f4f4f3'))).toBeLessThan(luminancia('#f4f4f3'));
  });
});

describe('comAlfa', () => {
  it('vira rgba', () => {
    expect(comAlfa('#124012', 0.55)).toBe('rgba(18, 64, 18, 0.55)');
  });
});
