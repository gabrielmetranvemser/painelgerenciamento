import { beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * A trava que decide se um domínio pode entrar num link de mensagem.
 *
 * ⚠️ O teste 2 é o que importa. Entre o gestor digitar o domínio e o DNS
 * responder passam horas, e nessa janela o endereço não abre. Se o painel
 * usasse o domínio antes de conferir, as mensagens do dia sairiam com um link
 * morto — e ninguém veria: o envio é registrado igual, e o que some é o clique,
 * que é a única prova de que a pessoa abriu o material.
 */

// `unstable_cache` só embrulha a função; aqui ela roda direto.
vi.mock('next/cache', () => ({
  unstable_cache: (fn: unknown) => fn,
}));
vi.mock('server-only', () => ({}));
vi.mock('next/headers', () => ({ headers: async () => new Headers() }));

const linhas = vi.fn();
vi.mock('@/lib/supabase/admin', () => ({
  criarClienteAdmin: () => ({
    from: () => ({ select: () => ({ not: async () => ({ data: linhas() }) }) }),
  }),
}));

const VERIFICADO = {
  id: 'id-sofia', slug: 'sofia-andrade',
  dominio: 'material.sofiaandrade.com.br',
  dominio_verificado_em: '2026-09-03T00:00:00Z',
};
const SEM_CONFERIR = {
  id: 'id-joao', slug: 'joao',
  dominio: 'material.joao.com.br',
  dominio_verificado_em: null,
};

const { candidatoPorDominio, enderecoDoCandidato, hostEhDeCandidato } =
  await import('./dominios-candidatos');

beforeEach(() => {
  linhas.mockReset();
  linhas.mockReturnValue([VERIFICADO, SEM_CONFERIR]);
});

describe('enderecoDoCandidato', () => {
  it('1. domínio conferido vira a base dos links daquele candidato', async () => {
    expect(await enderecoDoCandidato('id-sofia')).toBe('https://material.sofiaandrade.com.br');
  });

  // ⚠️ A trava.
  it('2. domínio ainda não conferido NÃO entra em link nenhum', async () => {
    expect(await enderecoDoCandidato('id-joao')).toBeNull();
  });

  it('3. candidato sem domínio usa o endereço padrão', async () => {
    expect(await enderecoDoCandidato('id-que-nao-existe')).toBeNull();
  });
});

describe('candidatoPorDominio', () => {
  it('4. acha o dono do host', async () => {
    expect(await candidatoPorDominio('material.sofiaandrade.com.br'))
      .toEqual({ id: 'id-sofia', slug: 'sofia-andrade' });
  });

  /**
   * ⚠️ O oposto da trava de cima, e de propósito: a página tem de responder
   * ANTES de o domínio ser conferido, porque conferir é abrir o endereço e
   * perguntar de quem ele é. Exigir verificação aqui seria exigir que o domínio
   * já estivesse verificado para poder ser verificado.
   */
  it('5. a página responde mesmo com o domínio ainda por conferir', async () => {
    expect(await candidatoPorDominio('material.joao.com.br'))
      .toEqual({ id: 'id-joao', slug: 'joao' });
  });

  it('6. host desconhecido não é de ninguém', async () => {
    expect(await candidatoPorDominio('outra-coisa.com.br')).toBeNull();
    expect(await candidatoPorDominio(null)).toBeNull();
    expect(await hostEhDeCandidato('outra-coisa.com.br')).toBe(false);
  });

  it('7. sem nenhum domínio cadastrado, nada casa', async () => {
    linhas.mockReturnValue(null);
    expect(await candidatoPorDominio('material.sofiaandrade.com.br')).toBeNull();
  });
});
