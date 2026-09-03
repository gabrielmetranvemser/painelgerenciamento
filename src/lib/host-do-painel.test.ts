import { afterEach, describe, expect, it } from 'vitest';
import { hostEhDoPainel } from './host-do-painel';

/**
 * ⚠️ Esta função existe por causa de um vazamento achado em teste: com o
 * domínio de um candidato apontando para cá, o caminho certo do painel
 * devolvia 307 para a tela de entrar enquanto qualquer outro devolvia 404 — e
 * essa diferença é exatamente o que o segmento secreto existe para esconder,
 * no host mais divulgado que o sistema tem.
 */
const ANTES = process.env.LINK_BASE_URL;
afterEach(() => { process.env.LINK_BASE_URL = ANTES; });

describe('hostEhDoPainel', () => {
  it('1. aceita o endereço declarado do painel', () => {
    process.env.LINK_BASE_URL = 'https://painelgerenciamento.vercel.app';
    expect(hostEhDoPainel('painelgerenciamento.vercel.app')).toBe(true);
    expect(hostEhDoPainel('painelgerenciamento.vercel.app:443')).toBe(true);
    expect(hostEhDoPainel('PainelGerenciamento.Vercel.App')).toBe(true);
  });

  // ⚠️ O vazamento.
  it('2. recusa o domínio próprio de um candidato', () => {
    process.env.LINK_BASE_URL = 'https://painelgerenciamento.vercel.app';
    expect(hostEhDoPainel('material.sofiaandrade.com.br')).toBe(false);
  });

  it('3. aceita qualquer deploy da Vercel, inclusive pré-visualização', () => {
    process.env.LINK_BASE_URL = 'https://painelgerenciamento.vercel.app';
    expect(hostEhDoPainel('painel-git-branch-abc.vercel.app')).toBe(true);
  });

  it('4. aceita localhost, mas NÃO um subdomínio dele', () => {
    process.env.LINK_BASE_URL = 'https://painelgerenciamento.vercel.app';
    expect(hostEhDoPainel('localhost:3000')).toBe(true);
    // É assim que se testa domínio próprio nesta máquina. Aceitar aqui
    // esconderia o defeito justamente no teste.
    expect(hostEhDoPainel('material.teste.localhost:3000')).toBe(false);
  });

  /**
   * Falha para o lado de DEIXAR ENTRAR: sem endereço declarado não dá para
   * saber qual é o host do painel, e trancar quem trabalha por causa de uma
   * variável faltando seria pior que responder num endereço a mais.
   */
  it('5. sem endereço declarado, não tranca ninguém', () => {
    delete process.env.LINK_BASE_URL;
    delete process.env.VERCEL_PROJECT_PRODUCTION_URL;
    delete process.env.VERCEL_URL;
    expect(hostEhDoPainel('qualquer-coisa.com.br')).toBe(true);
    expect(hostEhDoPainel(null)).toBe(true);
  });

  it('6. aceita o endereço declarado sem esquema, como a Vercel injeta', () => {
    delete process.env.LINK_BASE_URL;
    process.env.VERCEL_PROJECT_PRODUCTION_URL = 'painelgerenciamento.vercel.app';
    expect(hostEhDoPainel('painelgerenciamento.vercel.app')).toBe(true);
    expect(hostEhDoPainel('material.sofiaandrade.com.br')).toBe(false);
  });
});
