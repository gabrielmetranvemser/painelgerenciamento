/**
 * Monta os endereços internos a partir do segmento secreto da URL atual.
 *
 * Não lê variável de ambiente de propósito: assim este módulo pode ser
 * importado por componente de cliente sem levar a chave para o pacote.
 */
export function rotas(entrada: string) {
  const raiz = `/${entrada}`;
  return {
    entrar: `${raiz}/entrar`,
    termo: `${raiz}/termo`,
    instalar: `${raiz}/instalar`,
    extensao: `${raiz}/extensao`,
    suporte: `${raiz}/painel/suporte`,
    anexo: (id: string) => `${raiz}/suporte/anexo/${id}`,
    gestorSuporte: `${raiz}/gestor/suporte`,
    painel: `${raiz}/painel`,
    meusContatos: `${raiz}/painel/meus-contatos`,
    /** O roteiro completo da conversa. Abre em aba própria, ao lado do WhatsApp. */
    script: `${raiz}/painel/script`,
    contato: (id: string) => `${raiz}/painel/contatos/${id}`,
    gestor: `${raiz}/gestor`,
    gestorCandidatos: `${raiz}/gestor/candidatos`,
    gestorCandidato: (id: string) => `${raiz}/gestor/candidatos/${id}`,
    gestorCandidatoPrevia: (id: string) => `${raiz}/gestor/candidatos/${id}/previa`,
    gestorContatos: `${raiz}/gestor/contatos`,
    gestorEntregas: `${raiz}/gestor/entregas`,
    gestorListas: `${raiz}/gestor/listas`,
    gestorImportar: `${raiz}/gestor/importar`,
    gestorAtendentes: `${raiz}/gestor/atendentes`,
    gestorChips: `${raiz}/gestor/chips`,
    gestorMensagens: `${raiz}/gestor/mensagens`,
    gestorRelatorios: `${raiz}/gestor/relatorios`,
    gestorConfiguracao: `${raiz}/gestor/configuracao`,
    exportar: (relatorio: string) => `${raiz}/api/export/${relatorio}`,
  };
}

export type Rotas = ReturnType<typeof rotas>;
