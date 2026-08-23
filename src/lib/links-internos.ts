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
    painel: `${raiz}/painel`,
    meusContatos: `${raiz}/painel/meus-contatos`,
    contato: (id: string) => `${raiz}/painel/contatos/${id}`,
    gestor: `${raiz}/gestor`,
    gestorCandidatos: `${raiz}/gestor/candidatos`,
    gestorCandidato: (id: string) => `${raiz}/gestor/candidatos/${id}`,
    gestorContatos: `${raiz}/gestor/contatos`,
    gestorEntregas: `${raiz}/gestor/entregas`,
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
