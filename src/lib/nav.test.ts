import { describe, expect, it } from 'vitest';
import { itemAtivo } from './nav';

/**
 * O menu do gestor tem `/x/gestor` e `/x/gestor/contatos` na mesma lista. Com
 * `startsWith`, os dois acendiam ao mesmo tempo em toda tela interna.
 */
describe('itemAtivo', () => {
  const MENU = [
    '/x/gestor',
    '/x/gestor/contatos',
    '/x/gestor/candidatos',
    '/x/painel',
    '/x/painel/suporte',
  ];

  it('acende só o item mais específico', () => {
    expect(itemAtivo('/x/gestor/contatos', MENU)).toBe('/x/gestor/contatos');
    expect(itemAtivo('/x/painel/suporte', MENU)).toBe('/x/painel/suporte');
  });

  it('a raiz acende só quando é a raiz mesmo', () => {
    expect(itemAtivo('/x/gestor', MENU)).toBe('/x/gestor');
    expect(itemAtivo('/x/painel', MENU)).toBe('/x/painel');
  });

  // Uma tela filha sem item próprio acende o pai — é onde a pessoa está.
  it('tela sem item próprio acende o item pai', () => {
    expect(itemAtivo('/x/gestor/candidatos/abc-123', MENU)).toBe('/x/gestor/candidatos');
    expect(itemAtivo('/x/painel/contatos/abc-123', MENU)).toBe('/x/painel');
  });

  // Prefixo de texto não é prefixo de caminho: /x/gestorzinho não é /x/gestor.
  it('não confunde prefixo de texto com prefixo de caminho', () => {
    expect(itemAtivo('/x/gestorzinho', MENU)).toBe(null);
    expect(itemAtivo('/x/painelaria/coisa', MENU)).toBe(null);
  });

  it('caminho de fora do menu não acende nada', () => {
    expect(itemAtivo('/x/termo', MENU)).toBe(null);
  });
});
