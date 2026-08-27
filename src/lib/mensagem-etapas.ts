/**
 * Reexporta o montador de mensagem com o nome de etapa alinhado ao enum do
 * banco, para não haver dois tipos "Etapa" circulando pelo código.
 */
export {
  montarTexto,
  primeiroNomeDe,
  saudacao,
  horaLocal,
  validarModelo,
  podeSalvar,
  ehGrave,
  variaveisUsadas,
  proximaVariacao,
  VARIAVEIS_CONHECIDAS,
} from './mensagem';
export type { ContextoMensagem, Problema, CodigoProblema, NivelProblema } from './mensagem';
export type { Etapa as EtapaMensagem } from './mensagem';
