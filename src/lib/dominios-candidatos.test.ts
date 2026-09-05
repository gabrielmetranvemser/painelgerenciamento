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
let hostDaRequisicao = '';
vi.mock('next/headers', () => ({
  headers: async () => new Headers(hostDaRequisicao ? { host: hostDaRequisicao } : {}),
}));

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

const { candidatoPorDominio, chegouPeloEnderecoAntigo, dominioConferido,
        enderecoDoCandidato, hostEhDeCandidato } = await import('./dominios-candidatos');

beforeEach(() => {
  linhas.mockReset();
  linhas.mockReturnValue([VERIFICADO, SEM_CONFERIR]);
  hostDaRequisicao = 'painelgerenciamento.vercel.app';
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

/**
 * O bloqueio do endereço antigo.
 *
 * ⚠️ O corte é pelo HOST, nunca pelo token — e é a única forma que funciona. O
 * token de um material é o MESMO para sempre: o link que a pessoa recebeu há
 * três dias no endereço da Vercel e o que ela recebe hoje no domínio da
 * campanha carregam o mesmo `/r/abc123`. Desligar "os links antigos" pelo token
 * desligaria os novos junto, para a mesma pessoa.
 */
describe('chegouPeloEnderecoAntigo', () => {
  it('8. o endereço antigo morre para quem já tem domínio próprio', async () => {
    expect(await chegouPeloEnderecoAntigo({ slug: 'sofia-andrade' })).toBe(true);
    expect(await chegouPeloEnderecoAntigo({ id: 'id-sofia' })).toBe(true);
  });

  // ⚠️ Sem esta, o domínio novo bloqueia a si mesmo e não sobra endereço nenhum.
  it('9. o domínio novo NÃO se bloqueia', async () => {
    hostDaRequisicao = 'material.sofiaandrade.com.br';
    expect(await chegouPeloEnderecoAntigo({ slug: 'sofia-andrade' })).toBe(false);
  });

  /**
   * A saída de emergência. Enquanto o domínio não foi conferido — ou depois de
   * o gestor apagar o campo, se o domínio da campanha cair — o endereço da
   * Vercel volta a ser o único que existe, na hora e sem deploy.
   */
  it('10. domínio por conferir não bloqueia nada', async () => {
    expect(await chegouPeloEnderecoAntigo({ slug: 'joao' })).toBe(false);
    expect(await dominioConferido({ slug: 'joao' })).toBeNull();
  });

  it('11. candidato sem domínio continua no endereço de sempre', async () => {
    expect(await chegouPeloEnderecoAntigo({ slug: 'quem-nao-tem' })).toBe(false);
  });
});
