import { describe, expect, it } from 'vitest';
import {
  descreverPedido, linkDaRecepcao, MENSAGEM_RECEPCAO_PADRAO,
  montarMensagemRecepcao, problemaNaMensagemRecepcao,
} from './recepcao';

const MARIA = {
  nome: 'Maria Silva', primeiroNome: 'Maria',
  cidade: 'Porto Velho', candidato: 'Sofia Andrade 2233', itens: [],
};

describe('montarMensagemRecepcao', () => {
  it('1. o padrão sai como uma frase de gente', () => {
    expect(montarMensagemRecepcao(null, MARIA)).toBe(
      'Oi! Meu nome é Maria Silva, de Porto Velho. '
      + 'Acabei de pedir o material no site da campanha de Sofia Andrade 2233.',
    );
  });

  it('2. quem pediu kit já diz o que pediu', () => {
    expect(montarMensagemRecepcao(null, { ...MARIA, itens: ['camiseta', 'adesivo'] }))
      .toContain('o material impresso (camiseta e adesivo)');
  });

  it('3. o texto do gestor manda', () => {
    expect(montarMensagemRecepcao('Oi, sou {{primeiro_nome}}!', MARIA)).toBe('Oi, sou Maria!');
  });

  /**
   * ⚠️ Some com a variável e o gestor descobre o erro de digitação pelo texto
   * estranho no WhatsApp de um eleitor. Crua, ele vê na pré-visualização.
   */
  it('4. variável que não existe fica visível, não some', () => {
    expect(montarMensagemRecepcao('Oi {{nomee}}', MARIA)).toBe('Oi {{nomee}}');
  });

  it('5. variável vazia não deixa vírgula solta nem espaço dobrado', () => {
    expect(montarMensagemRecepcao('Sou {{nome}} , de {{cidade}}.', { ...MARIA, cidade: null }))
      .toBe('Sou Maria Silva, de.');
  });

  it('6. sem primeiro nome, usa o nome inteiro', () => {
    expect(montarMensagemRecepcao('{{primeiro_nome}}', { ...MARIA, primeiroNome: null }))
      .toBe('Maria Silva');
  });
});

describe('descreverPedido', () => {
  it('7. lista os itens em português', () => {
    expect(descreverPedido([])).toBe('o material');
    expect(descreverPedido(['camiseta'])).toBe('o material impresso (camiseta)');
    expect(descreverPedido(['camiseta', 'adesivo', 'boné']))
      .toBe('o material impresso (camiseta, adesivo e boné)');
  });
});

describe('linkDaRecepcao', () => {
  it('8. abre a conversa com o texto escrito, sem enviar nada', () => {
    expect(linkDaRecepcao('5569981234567', 'Oi! Tudo bem?'))
      .toBe('https://wa.me/5569981234567?text=Oi!%20Tudo%20bem%3F');
  });
});

describe('problemaNaMensagemRecepcao', () => {
  it('9. vazio é válido: usa o padrão', () => {
    expect(problemaNaMensagemRecepcao('')).toBeNull();
    expect(problemaNaMensagemRecepcao('   ')).toBeNull();
  });

  it('10. aponta o que está errado', () => {
    expect(problemaNaMensagemRecepcao('oi')).toBe('vazio');
    expect(problemaNaMensagemRecepcao('x'.repeat(401))).toBe('longo');
    expect(problemaNaMensagemRecepcao('Oi, sou {{apelido}} e tal')).toBe('variavel_desconhecida');
    expect(problemaNaMensagemRecepcao(MENSAGEM_RECEPCAO_PADRAO)).toBeNull();
  });
});
