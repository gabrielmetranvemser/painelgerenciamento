import { describe, expect, it } from 'vitest';
import { iniciais, linhaDeCima, paleta, versaoDaMarca, type CandidatoDaMarca } from '@/lib/marca';

const sofia: CandidatoDaMarca = {
  slug: 'sofia-andrade',
  nome_urna: 'Sofia Andrade 2233',
  cargo: 'deputado_federal',
  numero: '2233',
  partido_sigla: 'PL',
  coligacao: 'Juntos por Rondônia',
  cor_tema: '#fde016',
  cor_fundo: '#124012',
  foto_url: 'https://exemplo/logo.webp?v=1',
  tema: 'escuro',
};

describe('versaoDaMarca', () => {
  it('muda quando a logo muda', () => {
    // É o carimbo que faz o WhatsApp buscar a imagem de novo. Se ele não mudar,
    // trocar a logo em Candidatos não muda nada em aparelho nenhum.
    const outra = { ...sofia, foto_url: 'https://exemplo/logo.webp?v=2' };
    expect(versaoDaMarca(outra)).not.toBe(versaoDaMarca(sofia));
  });

  it('muda quando a cor muda', () => {
    expect(versaoDaMarca({ ...sofia, cor_tema: '#ff0000' })).not.toBe(versaoDaMarca(sofia));
  });

  it('não muda à toa', () => {
    expect(versaoDaMarca({ ...sofia })).toBe(versaoDaMarca(sofia));
  });

  it('sai curto e sem caractere que precise de escape na URL', () => {
    expect(versaoDaMarca(sofia)).toMatch(/^[a-z0-9]{1,8}$/);
  });
});

describe('linhaDeCima', () => {
  it('com logo, não repete o cargo — a logo já traz o cargo escrito', () => {
    expect(linhaDeCima(sofia, true)).toBe('PL · JUNTOS POR RONDÔNIA');
  });

  it('sem logo, o cargo volta: aí não está escrito em lugar nenhum', () => {
    expect(linhaDeCima(sofia, false)).toBe('DEPUTADO FEDERAL · PL');
  });

  it('aguenta candidato sem partido', () => {
    const sem = { ...sofia, partido_sigla: null, coligacao: null };
    expect(linhaDeCima(sem, true)).toBe('');
    expect(linhaDeCima(sem, false)).toBe('DEPUTADO FEDERAL');
  });
});

describe('iniciais', () => {
  it('pega as duas primeiras palavras', () => {
    expect(iniciais('Sofia Andrade')).toBe('SA');
  });

  it('pula o número que costuma vir no nome de urna', () => {
    expect(iniciais('2233 Sofia Andrade')).toBe('SA');
  });

  it('nunca devolve vazio', () => {
    expect(iniciais('2233')).toBe('?');
  });
});

describe('paleta', () => {
  it('usa as cores do candidato', () => {
    const p = paleta(sofia);
    expect(p.fundo).toBe('#124012');
    expect(p.acento).toBe('#fde016');
    expect(p.tintaAcento).toBe('#111111');
  });

  it('cai no padrão do sistema quando o gestor não escolheu nada', () => {
    const p = paleta({ ...sofia, cor_tema: null, cor_fundo: null, tema: 'escuro' });
    expect(p.fundo).toBe('#08090b');
    expect(p.acento).toBe('#c6f24e');
  });

  it('no tema claro, o acento escurece sozinho — lima sobre branco não lê', () => {
    const p = paleta({ ...sofia, cor_tema: null, cor_fundo: null, tema: 'claro' });
    expect(p.fundo).toBe('#f4f4f3');
    expect(p.acento).toBe('#4d7c0f');
    expect(p.texto).toBe('#111111');
  });
});
