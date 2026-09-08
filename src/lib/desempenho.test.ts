import { describe, expect, it } from 'vitest';
import { ROTULO_STATUS_CONTATO, type StatusContato } from './tipos-banco';
import {
  GRUPOS_DE_DESFECHO, GRUPO_DO_STATUS, corDoStatus, diaCurto, duracao, grupoDoStatus,
  periodoEscolhido, porDiaTrabalhado, porcento, quemTrabalhou, relogio, rotuloDoStatus,
  somar, taxa, type LinhaDaEquipe,
} from './desempenho';

function linha(p: Partial<LinhaDaEquipe> = {}): LinhaDaEquipe {
  return {
    atendente_id: 'a', atendente: 'Alguém', ativo: true, foto_url: null,
    aberturas: 0, pessoas: 0, dias_trabalhados: 0, horas_ativas: 0,
    positivos: 0, autorizou: 0, negativos: 0, sem_resposta: 0, em_aberto: 0,
    cliques: 0, na_mao_agora: 0, aguardando_resposta: 0, abertos_sem_falar: 0,
    ...p,
  };
}

describe('periodoEscolhido', () => {
  it('1. aceita só o que a barra de botões sabe desenhar', () => {
    expect(periodoEscolhido('7')).toBe(7);
    expect(periodoEscolhido('0')).toBe(0);
    expect(periodoEscolhido('90')).toBe(90);
  });

  /**
   * ⚠️ Sem esta trava, `?dias=100000` chega ao banco e volta um recorte que
   * nenhum botão representa — a tela ficaria sem nada marcado, e o gestor
   * olhando um período sem saber qual é.
   */
  it('2. o que não está na lista vira 30', () => {
    expect(periodoEscolhido('100000')).toBe(30);
    expect(periodoEscolhido('-5')).toBe(30);
    expect(periodoEscolhido('abc')).toBe(30);
    expect(periodoEscolhido(undefined)).toBe(30);
    expect(periodoEscolhido('')).toBe(30);
  });
});

describe('os quatro grupos de desfecho', () => {
  /**
   * ⚠️ Este é o teste que importa. A RPC define "ainda aberto" pelo NEGATIVO
   * dos outros três, então todo status precisa cair em exatamente um grupo. Um
   * desfecho novo que ficasse fora da tabela viraria uma barra que não soma com
   * o número escrito logo acima dela — e nada avisaria.
   */
  it('3. todo status do banco tem um grupo, e só um', () => {
    for (const status of Object.keys(ROTULO_STATUS_CONTATO) as StatusContato[]) {
      const grupo = GRUPO_DO_STATUS[status];
      expect(grupo, `status "${status}" sem grupo`).toBeDefined();
      expect(GRUPOS_DE_DESFECHO.filter((g) => g.chave === grupo)).toHaveLength(1);
    }
  });

  it('4. quem autorizou é acerto; quem pediu saída não é', () => {
    expect(grupoDoStatus('autorizou')).toBe('positivos');
    expect(grupoDoStatus('ja_apoia')).toBe('positivos');
    expect(grupoDoStatus('pediu_saida')).toBe('negativos');
    expect(grupoDoStatus('invalido')).toBe('negativos');
    expect(grupoDoStatus('sem_resposta')).toBe('sem_resposta');
    expect(grupoDoStatus('em_atendimento')).toBe('em_aberto');
    expect(grupoDoStatus('falar_depois')).toBe('em_aberto');
  });

  // Status desconhecido não pode derrubar a tela: cai no grupo que não afirma nada.
  it('5. status que a tela não conhece cai em "ainda aberto"', () => {
    expect(grupoDoStatus('inventado')).toBe('em_aberto');
    expect(rotuloDoStatus('inventado')).toBe('inventado');
    expect(corDoStatus('inventado')).toBe('var(--tenue)');
  });

  it('6. o rótulo vem da tabela única do sistema', () => {
    expect(rotuloDoStatus('nao_e_a_pessoa')).toBe('Não é a pessoa');
    expect(rotuloDoStatus('em_atendimento')).toBe('Aguardando resposta');
  });
});

describe('relógio e duração', () => {
  it('7. minutos desde a meia-noite viram hora de parede', () => {
    expect(relogio(0)).toBe('00:00');
    expect(relogio(970)).toBe('16:10');
    expect(relogio(1439)).toBe('23:59');
  });

  // Vem do banco; não pode estourar o mostrador nem imprimir "24:00".
  it('8. valor fora da faixa não vira hora impossível', () => {
    expect(relogio(-10)).toBe('00:00');
    expect(relogio(5000)).toBe('23:59');
  });

  it('9. duração é lida como duração, não como horário', () => {
    expect(duracao(45)).toBe('45min');
    expect(duracao(60)).toBe('1h');
    expect(duracao(200)).toBe('3h20');
    expect(duracao(0)).toBe('0min');
  });
});

describe('diaCurto', () => {
  /**
   * ⚠️ `new Date('2026-09-05')` é meia-noite em UTC, que em Rondônia (UTC−4)
   * ainda é dia 4. Sem o meio-dia, todo rótulo do gráfico apareceria um dia
   * atrasado — e um gráfico só deslocado não levanta suspeita de ninguém.
   */
  it('10. a data não anda para trás por causa do fuso', () => {
    expect(diaCurto('2026-09-05')).toBe('05/09');
    expect(diaCurto('2026-01-01')).toBe('01/01');
    expect(diaCurto('2026-12-31')).toBe('31/12');
  });
});

describe('divisões', () => {
  it('11. sem base para dividir, "—" em vez de NaN na tela', () => {
    expect(taxa(0, 0)).toBe('—');
    expect(porcento(3, 0)).toBe(0);
    expect(porDiaTrabalhado(linha())).toBe(0);
  });

  it('12. a taxa é sobre quem foi abordado', () => {
    expect(taxa(28, 245)).toBe('11%');
    expect(taxa(1, 1)).toBe('100%');
  });

  /**
   * ⚠️ Divide pelos dias em que a pessoa DE FATO trabalhou, e não pelos dias do
   * período. Pelo período, quem entrou na equipe ontem apareceria como o pior
   * da lista — e o gestor usa este número para comparar gente.
   */
  it('13. a média é por dia trabalhado, não por dia do calendário', () => {
    expect(porDiaTrabalhado(linha({ pessoas: 90, dias_trabalhados: 9 }))).toBe(10);
    expect(porDiaTrabalhado(linha({ pessoas: 30, dias_trabalhados: 1 }))).toBe(30);
  });
});

describe('a equipe', () => {
  const equipe = [
    linha({ atendente_id: '1', pessoas: 10, aberturas: 12, autorizou: 3 }),
    linha({ atendente_id: '2', pessoas: 0, aberturas: 0 }),
    linha({ atendente_id: '3', pessoas: 5, aberturas: 9, autorizou: 1 }),
  ];

  it('14. somar percorre a coluna inteira', () => {
    expect(somar(equipe, 'pessoas')).toBe(15);
    expect(somar(equipe, 'aberturas')).toBe(21);
    expect(somar(equipe, 'autorizou')).toBe(4);
    expect(somar([], 'pessoas')).toBe(0);
  });

  // Quinze linhas em zero empurram para fora da tela justamente as que o gestor
  // abriu a página para ver.
  it('15. o ranking mostra só quem apareceu no período', () => {
    expect(quemTrabalhou(equipe).map((l) => l.atendente_id)).toEqual(['1', '3']);
  });

  it('16. quem abriu conversa sem fechar nenhuma pessoa ainda conta', () => {
    expect(quemTrabalhou([linha({ pessoas: 0, aberturas: 2 })])).toHaveLength(1);
  });
});
