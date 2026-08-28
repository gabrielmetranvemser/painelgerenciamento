import { describe, expect, it } from 'vitest';
import {
  coordenadaPlausivel, distanciaKm, formatarDistancia, lerCoordenada,
} from './distancia';

// Coordenadas reais, para as contas terem referência no mundo.
const PORTO_VELHO = { lat: -8.76077, lon: -63.8999 };
const JI_PARANA = { lat: -10.8853, lon: -61.9517 };
const ARIQUEMES = { lat: -9.9134, lon: -63.0409 };

describe('distanciaKm', () => {
  it('devolve zero para o mesmo ponto', () => {
    expect(distanciaKm(PORTO_VELHO, PORTO_VELHO)).toBe(0);
  });

  it('bate com a distância conhecida entre Porto Velho e Ji-Paraná', () => {
    // ~318 km em linha reta (a estrada tem ~376 km — a diferença é justamente
    // o que a tela precisa dizer, e por isso o texto fala "em linha reta").
    //
    // A margem é larga de propósito: o que este teste protege é a ordem de
    // grandeza. Trocar lat com lon, ou esquecer a conversão para radianos, erra
    // por um fator de dez ou mais.
    const km = distanciaKm(PORTO_VELHO, JI_PARANA);
    expect(km).toBeGreaterThan(300);
    expect(km).toBeLessThan(335);
  });

  it('é simétrica', () => {
    expect(distanciaKm(PORTO_VELHO, ARIQUEMES))
      .toBeCloseTo(distanciaKm(ARIQUEMES, PORTO_VELHO), 6);
  });

  it('ordena as cidades como o mapa ordena', () => {
    expect(distanciaKm(PORTO_VELHO, ARIQUEMES))
      .toBeLessThan(distanciaKm(PORTO_VELHO, JI_PARANA));
  });
});

describe('coordenadaPlausivel', () => {
  it('aceita um ponto de Rondônia', () => {
    expect(coordenadaPlausivel(PORTO_VELHO)).toBe(true);
  });

  it('recusa latitude e longitude trocadas', () => {
    // O erro clássico de copiar e colar. Sem esta trava, a tela mostraria a
    // distância até um ponto no meio do oceano Índico com toda a seriedade.
    expect(coordenadaPlausivel({ lat: -63.8999, lon: -8.76077 })).toBe(false);
  });

  it('recusa NaN e infinito', () => {
    expect(coordenadaPlausivel({ lat: NaN, lon: -63 })).toBe(false);
    expect(coordenadaPlausivel({ lat: Infinity, lon: -63 })).toBe(false);
  });

  it('recusa ponto fora do Brasil', () => {
    expect(coordenadaPlausivel({ lat: 48.85, lon: 2.35 })).toBe(false);
  });
});

describe('lerCoordenada', () => {
  it('lê o formato que o Google Maps copia', () => {
    expect(lerCoordenada('-8.76077, -63.8999')).toEqual(PORTO_VELHO);
  });

  it('lê com vírgula decimal, que é o que sai em português', () => {
    expect(lerCoordenada('-8,76077 -63,8999')).toEqual(PORTO_VELHO);
  });

  it('lê separado por ponto e vírgula', () => {
    expect(lerCoordenada('-8.76077; -63.8999')).toEqual(PORTO_VELHO);
  });

  it('devolve null para texto que não é coordenada', () => {
    expect(lerCoordenada('Rua das Flores, 123')).toBeNull();
    expect(lerCoordenada('')).toBeNull();
    expect(lerCoordenada('-8.76077')).toBeNull();
  });

  it('devolve null para um par implausível em vez de gravá-lo', () => {
    expect(lerCoordenada('48.85, 2.35')).toBeNull();
  });
});

describe('formatarDistancia', () => {
  it('não promete precisão que o cálculo não tem', () => {
    expect(formatarDistancia(0.4)).toBe('menos de 1 km');
    expect(formatarDistancia(0.99)).toBe('menos de 1 km');
  });

  it('usa uma casa decimal e vírgula até 10 km', () => {
    expect(formatarDistancia(2.34)).toBe('2,3 km');
    expect(formatarDistancia(9.96)).toBe('10,0 km');
  });

  it('arredonda para inteiro acima de 10 km', () => {
    expect(formatarDistancia(12.4)).toBe('12 km');
    expect(formatarDistancia(289.7)).toBe('290 km');
  });
});
