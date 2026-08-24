import { describe, expect, it } from 'vitest';
import {
  enderecoUtilizavel, formatarCep, mascaraCep, mesmaCidade,
  montarLinhaEndereco, normalizarCep,
} from './cep';

describe('normalizarCep', () => {
  it('aceita as formas que aparecem quando alguém cola de outro lugar', () => {
    expect(normalizarCep('76801-000')).toBe('76801000');
    expect(normalizarCep('76801000')).toBe('76801000');
    expect(normalizarCep('76.801-000')).toBe('76801000');
    expect(normalizarCep(' 76801 000 ')).toBe('76801000');
  });

  it('recusa o que não tem 8 dígitos', () => {
    expect(normalizarCep('7680100')).toBeNull();
    expect(normalizarCep('768010000')).toBeNull();
    expect(normalizarCep('')).toBeNull();
    expect(normalizarCep(null)).toBeNull();
    expect(normalizarCep(undefined)).toBeNull();
    expect(normalizarCep('não sei')).toBeNull();
  });
});

describe('mascaraCep', () => {
  it('formata enquanto digita', () => {
    expect(mascaraCep('7')).toBe('7');
    expect(mascaraCep('76801')).toBe('76801');
    expect(mascaraCep('768010')).toBe('76801-0');
    expect(mascaraCep('76801000')).toBe('76801-000');
  });

  it('corta o excesso em vez de guardar lixo invisível', () => {
    expect(mascaraCep('768010001234')).toBe('76801-000');
  });

  it('não deixa o hífen digitado virar dois hífens', () => {
    expect(mascaraCep('76801-000')).toBe('76801-000');
  });
});

describe('formatarCep', () => {
  it('devolve o que veio quando não dá para formatar', () => {
    expect(formatarCep('76801000')).toBe('76801-000');
    expect(formatarCep('123')).toBe('123');
  });
});

describe('mesmaCidade', () => {
  it('ignora acento, apóstrofo e caixa', () => {
    // O serviço de CEP e a nossa tabela escrevem diferente. Sem isto o
    // formulário acusaria "cidade errada" para quem digitou o CEP certo.
    expect(mesmaCidade("Espigão D'Oeste", "Espigão d'Oeste")).toBe(true);
    expect(mesmaCidade('Ji-Parana', 'Ji-Paraná')).toBe(true);
    expect(mesmaCidade('PORTO VELHO', 'Porto Velho')).toBe(true);
    expect(mesmaCidade("Alta Floresta D'Oeste", 'Alta Floresta do Oeste')).toBe(false);
  });

  it('nulo nunca casa — não sabemos, então não afirmamos', () => {
    expect(mesmaCidade(null, 'Porto Velho')).toBe(false);
    expect(mesmaCidade('Porto Velho', null)).toBe(false);
  });
});

describe('enderecoUtilizavel', () => {
  it('exige rua e bairro — é o mínimo para achar a casa', () => {
    expect(enderecoUtilizavel({ cep: '76801000', rua: 'Rua A', numero: '1', bairro: 'Centro' })).toBe(true);
    expect(enderecoUtilizavel({ cep: '76801000', rua: 'Rua A', numero: null, bairro: null })).toBe(false);
    expect(enderecoUtilizavel({ cep: null, rua: '  ', numero: '1', bairro: 'Centro' })).toBe(false);
  });
});

describe('montarLinhaEndereco', () => {
  it('monta a linha que a equipe de entrega lê', () => {
    expect(montarLinhaEndereco({
      cep: '76801000', rua: 'Rua das Flores', numero: '123', bairro: 'Centro',
    })).toBe('Rua das Flores, 123 — Centro · CEP 76801-000');
  });

  it('não deixa buraco quando falta parte', () => {
    expect(montarLinhaEndereco({
      cep: null, rua: 'Linha 25, km 8', numero: 'S/N', bairro: 'Zona Rural',
    })).toBe('Linha 25, km 8, S/N — Zona Rural');

    expect(montarLinhaEndereco({
      cep: '76801000', rua: null, numero: null, bairro: null,
    })).toBe('CEP 76801-000');

    expect(montarLinhaEndereco({ cep: null, rua: null, numero: null, bairro: null })).toBe('');
  });
});
