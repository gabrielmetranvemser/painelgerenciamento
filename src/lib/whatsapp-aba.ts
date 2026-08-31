/**
 * Abrir a conversa do WhatsApp reaproveitando a aba que já está aberta.
 *
 * ⚠️ O PROBLEMA, EM UMA FRASE: uma página web só consegue reaproveitar uma aba
 * que ELA MESMA abriu. O painel nomeia a janela (`window.open(url, JANELA_WA)`)
 * e por isso reaproveita a aba a partir da SEGUNDA conversa — mas a aba de
 * WhatsApp que o atendente abriu por conta, antes de começar o turno, não tem
 * esse nome. Resultado: a primeira conversa abre uma aba nova ao lado da dele,
 * e quem trabalha com as duas janelas lado a lado acaba com duas sessões de
 * WhatsApp Web na tela.
 *
 * A extensão do painel enxerga as abas do navegador e resolve isso: acha a aba
 * de WhatsApp que existe, manda para o endereço da conversa e traz para a
 * frente. Uma aba, sempre a mesma, seja ela de quem for.
 *
 * ⚠️ Ela NÃO automatiza envio. Continua sendo o mesmo link oficial
 * `web.whatsapp.com/send?phone=…&text=…` que o painel já usava: abre o chat com
 * o texto preenchido e para. Quem revisa e aperta enviar é a pessoa. A extensão
 * pede `tabs`, e não `scripting` — não tem como tocar no conteúdo da página.
 * Ver docs/01-VISAO-GERAL.md §2.
 *
 * SEM A EXTENSÃO INSTALADA, tudo continua funcionando como antes: cai no
 * `window.open` nomeado. É por isso que esta função nunca falha para o
 * atendente — no pior caso ela faz o que já fazia.
 */

/**
 * O id da extensão, derivado da chave pública do `manifest.json`.
 *
 * O Chrome calcula o id assim: SHA-256 da chave em DER, os 16 primeiros bytes,
 * e cada dígito hexadecimal mapeado de 0–f para a–p. Como a chave está fixa no
 * manifest, o id é sempre este — inclusive quando a extensão é carregada sem
 * compactação, que é como a operação instala.
 *
 * Não é segredo: aparece em `chrome://extensions` para quem tem a extensão. O
 * que é secreto é o endereço do painel, e ele não está aqui.
 *
 * Há um teste que recalcula isto a partir do manifest — se a chave mudar e este
 * valor não, o teste cai.
 */
export const ID_DA_EXTENSAO = 'pdpffmibfeikfffdbpfklhdkifmceden';

type RespostaExtensao = { ok: boolean; criou?: boolean; motivo?: string };

type ChromeExterno = {
  runtime?: {
    sendMessage?: (
      id: string,
      mensagem: unknown,
      resposta: (r?: RespostaExtensao) => void,
    ) => void;
    lastError?: { message?: string };
  };
};

/** `chrome.runtime` só existe na página quando a extensão declara `externally_connectable`. */
function extensao(): ChromeExterno['runtime'] | null {
  const c = (globalThis as unknown as { chrome?: ChromeExterno }).chrome;
  return typeof c?.runtime?.sendMessage === 'function' ? c.runtime : null;
}

/** `true` quando a extensão está instalada e falando com esta página. */
export function temExtensao(): boolean {
  return extensao() !== null;
}

/**
 * Pede à extensão que leve a aba do WhatsApp para esta conversa.
 *
 * Devolve `false` quando não há extensão ou ela recusou — aí quem chama abre do
 * jeito antigo. O tempo limite existe porque uma extensão desligada no meio da
 * conversa deixaria a promessa pendurada, e o atendente ficaria olhando um
 * botão que não faz nada.
 */
export function abrirNaAbaDoWhatsapp(url: string): Promise<boolean> {
  const runtime = extensao();
  const enviar = runtime?.sendMessage;
  if (!runtime || !enviar) return Promise.resolve(false);

  return new Promise<boolean>((resolver) => {
    let respondido = false;
    const terminar = (v: boolean) => {
      if (respondido) return;
      respondido = true;
      resolver(v);
    };

    const relogio = setTimeout(() => terminar(false), 1200);

    try {
      enviar(ID_DA_EXTENSAO, { tipo: 'abrir-conversa', url }, (r) => {
        clearTimeout(relogio);
        // `lastError` PRECISA ser lido, senão o Chrome escreve um erro no
        // console de quem não tem a extensão — e o atendente vê vermelho por
        // causa de algo que é opcional.
        const erro = runtime.lastError;
        terminar(!erro && r?.ok === true);
      });
    } catch {
      clearTimeout(relogio);
      terminar(false);
    }
  });
}
