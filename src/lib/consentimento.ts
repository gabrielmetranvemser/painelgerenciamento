import { ROTULO_CARGO, type CargoEleitoral } from '@/lib/tipos-banco';

/**
 * A frase que a pessoa marca ao se cadastrar.
 *
 * Fica numa função, e não escrita na tela, por um motivo só: o texto tem de ser
 * IDÊNTICO ao que vai gravado em `captacoes.texto_aceite`. Se a tela mostrasse
 * uma frase e o servidor guardasse outra, a prova de consentimento valeria
 * nada — provaria que alguém clicou, não em quê.
 *
 * Nomear o candidato aqui é o que torna o consentimento "específico e
 * informado": a pessoa autoriza uma candidatura, não "a campanha".
 */
export function textoDoAceite(candidato: {
  nome_urna: string;
  cargo: CargoEleitoral;
  numero: string;
}): string {
  return (
    `Autorizo receber pelo WhatsApp o material da campanha de ${candidato.nome_urna}, ` +
    `${ROTULO_CARGO[candidato.cargo].toLowerCase()}, número ${candidato.numero}. ` +
    'Sei que quem fala comigo é uma pessoa da equipe, não um robô, e que posso pedir ' +
    'para sair a qualquer momento.'
  );
}
