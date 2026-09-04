/**
 * A mensagem que a PESSOA envia à campanha depois de preencher o formulário.
 *
 * ⚠️ O sentido da mensagem é o contrário de todo o resto deste sistema, e é por
 * isso que ela não mora em `mensagem.ts`.
 *
 * `validarModelo` cobra identificação da propaganda, forma de sair e chapa
 * declarada. Aquilo é exigência de quem ABORDA. Aqui quem escreve é o eleitor,
 * do aparelho dele, para a campanha — cobrar CNPJ num "oi, acabei de pedir o
 * material" seria absurdo, e reaproveitar aquelas regras encheria a tela do
 * gestor de erros que não fazem sentido nenhum neste texto.
 *
 * Arquivo NEUTRO (sem `server-only`, sem `'use client'`): o formulário do
 * gestor pré-visualiza com a mesma função que o servidor usa para montar o
 * link. Duas implementações divergiriam, e a divergência só apareceria no
 * WhatsApp de um eleitor.
 */

/** O padrão, quando o gestor não escreveu nada. */
export const MENSAGEM_RECEPCAO_PADRAO =
  'Oi! Meu nome é {{nome}}, de {{cidade}}. '
  + 'Acabei de pedir {{pedido}} no site da campanha de {{candidato}}.';

export const VARIAVEIS_RECEPCAO = [
  ['{{nome}}', 'o nome que a pessoa escreveu'],
  ['{{primeiro_nome}}', 'só o primeiro nome'],
  ['{{cidade}}', 'a cidade escolhida no formulário'],
  ['{{candidato}}', 'o nome de urna de quem ela pediu'],
  ['{{pedido}}', '"o material" ou "o material impresso (camiseta, adesivo)"'],
] as const;

export type ContextoRecepcao = {
  nome: string;
  primeiroNome: string | null;
  cidade: string | null;
  candidato: string;
  /** Os itens do kit, quando ela pediu material impresso. */
  itens: readonly string[];
};

/**
 * "o material" ou "o material impresso (camiseta, adesivo)".
 *
 * Existe como variável e não como frase escrita porque a diferença muda o que o
 * atendente precisa fazer: um pedido de kit tem endereço e tamanho para
 * conferir, e a primeira mensagem já dizendo isso poupa uma ida e volta.
 */
export function descreverPedido(itens: readonly string[]): string {
  if (itens.length === 0) return 'o material';
  return `o material impresso (${listar(itens)})`;
}

/** "camiseta", "camiseta e adesivo", "camiseta, adesivo e boné". */
function listar(itens: readonly string[]): string {
  if (itens.length <= 1) return itens[0] ?? '';
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}

/**
 * Troca as variáveis pelo que a pessoa preencheu.
 *
 * Variável desconhecida fica como está, de propósito: sumir com ela esconderia
 * o erro de digitação do gestor, e ele descobriria pelo texto estranho no
 * WhatsApp de um eleitor. Aparecendo crua, ele vê na pré-visualização.
 */
export function montarMensagemRecepcao(
  template: string | null | undefined,
  ctx: ContextoRecepcao,
): string {
  const valores: Record<string, string> = {
    nome: ctx.nome.trim(),
    primeiro_nome: (ctx.primeiroNome ?? ctx.nome).trim(),
    cidade: ctx.cidade?.trim() ?? '',
    candidato: ctx.candidato.trim(),
    pedido: descreverPedido(ctx.itens),
  };

  const texto = (template?.trim() || MENSAGEM_RECEPCAO_PADRAO).replace(
    /\{\{\s*([a-z_]+)\s*\}\}/g,
    (cru, chave: string) => (chave in valores ? valores[chave] : cru),
  );

  // Uma variável vazia deixa espaço dobrado e vírgula solta. Ninguém revisa o
  // texto antes de ele aparecer no WhatsApp de outra pessoa.
  return texto.replace(/[ \t]+/g, ' ').replace(/\s+([,.!?])/g, '$1').trim();
}

/**
 * O link que abre o WhatsApp com o texto já escrito.
 *
 * ⚠️ Isto NÃO envia nada. `wa.me` abre a conversa com o campo preenchido e
 * quem aperta enviar é a pessoa, no aparelho dela. É o mesmo mecanismo que o
 * painel já usa para o atendente — e é o que mantém a operação fora da
 * definição de disparo automático (CLAUDE.md, primeiro princípio).
 */
export function linkDaRecepcao(numeroE164: string, texto: string): string {
  return `https://wa.me/${numeroE164}?text=${encodeURIComponent(texto)}`;
}

export type ProblemaRecepcao = 'vazio' | 'longo' | 'variavel_desconhecida';

export const TEXTO_PROBLEMA_RECEPCAO: Record<ProblemaRecepcao, string> = {
  vazio: 'Escreva a mensagem, ou apague o campo para usar a padrão.',
  longo: 'Mensagem longa demais — a pessoa lê antes de enviar, e ninguém lê um parágrafo.',
  variavel_desconhecida: 'Há uma variável que o sistema não conhece. Confira a escrita.',
};

export function problemaNaMensagemRecepcao(texto: string): ProblemaRecepcao | null {
  const t = texto.trim();
  if (!t) return null;                 // vazio = usa o padrão, e isso é válido
  if (t.length < 10) return 'vazio';
  if (t.length > 400) return 'longo';

  const conhecidas = VARIAVEIS_RECEPCAO.map(([v]) => v.slice(2, -2));
  const usadas = [...t.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)].map((m) => m[1]);
  if (usadas.some((v) => !conhecidas.includes(v))) return 'variavel_desconhecida';

  return null;
}
