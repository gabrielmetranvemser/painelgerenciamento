import { describe, expect, it } from 'vitest';
import { comiteMaisPerto, enderecoDoComite, type Comite } from './comites';

const base: Comite = {
  id: 'x', nome: 'Comitê', municipio: 'Porto Velho', municipio_id: 1,
  cep: null, rua: null, numero: null, bairro: null,
  latitude: null, longitude: null, horario: null, telefone: null,
};

const comite = (p: Partial<Comite>): Comite => ({ ...base, ...p });

const PORTO_VELHO = { lat: -8.76077, lon: -63.8999 };

describe('comiteMaisPerto', () => {
  it('não inventa comitê quando não há nenhum', () => {
    expect(comiteMaisPerto([], { ponto: PORTO_VELHO, municipioId: 1 })).toBeNull();
  });

  it('escolhe o mais próximo quando os dois lados têm coordenada', () => {
    const perto = comite({ id: 'perto', nome: 'Centro', latitude: -8.77, longitude: -63.9 });
    const longe = comite({ id: 'longe', nome: 'Ji-Paraná', latitude: -10.88, longitude: -61.95 });

    const r = comiteMaisPerto([longe, perto], { ponto: PORTO_VELHO, municipioId: 1 });
    expect(r?.criterio).toBe('distancia');
    expect(r?.comite.id).toBe('perto');
  });

  it('cai para o município quando a pessoa não tem coordenada', () => {
    // O caso real de Rondônia: em cidade pequena o CEP é um só para o município
    // inteiro, e o serviço não devolve coordenada.
    const c = comite({ municipio_id: 7, latitude: -9.9, longitude: -63.04 });
    const r = comiteMaisPerto([c], { ponto: null, municipioId: 7 });
    expect(r).toEqual({ comite: c, criterio: 'municipio' });
  });

  it('cai para o município quando o comitê ainda não tem coordenada', () => {
    const c = comite({ municipio_id: 3 });
    const r = comiteMaisPerto([c], { ponto: PORTO_VELHO, municipioId: 3 });
    expect(r).toEqual({ comite: c, criterio: 'municipio' });
  });

  it('não anuncia comitê de outra cidade quando não dá para medir', () => {
    // ⚠️ A trava que importa. Sem ela, quem mora em Vilhena veria "temos um
    // comitê perto de você" apontando para Porto Velho, a 700 km.
    const c = comite({ municipio_id: 1 });
    expect(comiteMaisPerto([c], { ponto: null, municipioId: 52 })).toBeNull();
  });

  it('não anuncia nada quando não há coordenada nem município', () => {
    const c = comite({ municipio_id: 1 });
    expect(comiteMaisPerto([c], { ponto: null, municipioId: null })).toBeNull();
  });

  it('prefere medir a distância a supor pela cidade', () => {
    const outraCidade = comite({ id: 'medido', municipio_id: 9, latitude: -8.77, longitude: -63.9 });
    const mesmaCidade = comite({ id: 'suposto', municipio_id: 1 });

    const r = comiteMaisPerto([mesmaCidade, outraCidade], { ponto: PORTO_VELHO, municipioId: 1 });
    expect(r?.criterio).toBe('distancia');
    expect(r?.comite.id).toBe('medido');
  });
});

describe('enderecoDoComite', () => {
  it('monta com o que existe', () => {
    expect(enderecoDoComite(comite({
      rua: 'Av. Pinheiro Machado', numero: '1200', bairro: 'Centro',
    }))).toBe('Av. Pinheiro Machado, 1200 — Centro — Porto Velho');
  });

  it('não deixa buraco quando falta pedaço', () => {
    expect(enderecoDoComite(comite({ rua: 'Rua A', numero: null, bairro: null })))
      .toBe('Rua A — Porto Velho');
    expect(enderecoDoComite(comite({ municipio: null }))).toBe('');
  });
});
