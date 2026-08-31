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

type RespostaExtensao = { ok: boolean; criou?: boolean; motivo?: string; versao?: string };

/**
 * A versão mínima que sabe reaproveitar a aba do WhatsApp.
 *
 * ⚠️ Quem tem uma anterior precisa REINSTALAR — não há atualização automática:
 * a extensão é carregada sem compactação, direto de uma pasta na máquina de
 * cada atendente (ver `COMO-INSTALAR.txt`). Enquanto não reinstalar, o painel
 * segue funcionando pelo caminho antigo, abrindo aba nova.
 */
export const VERSAO_MINIMA = '1.1.0';

/** O que o painel sabe sobre a extensão de quem está com a tela aberta. */
export type EstadoDaExtensao =
  /** Instalada e na versão que sabe achar a aba. */
  | 'atual'
  /** Instalada, mas velha demais: precisa reinstalar. */
  | 'antiga'
  /** Não instalada, ou o painel está numa aba comum. */
  | 'ausente'
  /** Ainda perguntando. */
  | 'verificando';

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

/**
 * O painel está rodando DENTRO do painel lateral da extensão?
 *
 * ⚠️ É o que distingue "extensão velha" de "extensão nenhuma", e sem essa
 * distinção o aviso de atualizar apareceria para quem nunca instalou — que é
 * quase todo mundo no começo, porque o painel funciona 100% numa aba comum.
 *
 * A extensão carrega o painel num iframe (`sidepanel.html`). Então: se estamos
 * num iframe cujo ancestral é uma página de extensão, e mesmo assim ela não
 * responde, a extensão instalada é anterior a `externally_connectable` — ou
 * seja, velha.
 *
 * `ancestorOrigins` é do Chrome, que é o navegador da operação. Sem ele, o
 * `window.top !== window.self` já basta: o painel não é embutido em nenhum
 * outro lugar.
 */
export function dentroDoPainelLateral(): boolean {
  try {
    if (window.top === window.self) return false;
    const ancestrais = window.location.ancestorOrigins;
    if (!ancestrais || ancestrais.length === 0) return true;
    return Array.from(ancestrais).some((o) => o.startsWith('chrome-extension://'));
  } catch {
    // Cross-origin ao ler `window.top` já é sinal de que estamos embutidos.
    return true;
  }
}

/**
 * Marca, no navegador, que esta pessoa USA a extensão.
 *
 * ⚠️ Existe para resolver um ponto cego real, relatado em 31/08: numa aba
 * normal do Chrome, a extensão ANTIGA é indistinguível de "nenhuma extensão" —
 * ela não declara `externally_connectable`, então não responde. O atendente
 * abria "Preparar máquina" numa aba comum, com a versão velha instalada, e a
 * página não dizia nada sobre trocar.
 *
 * A memória fecha essa lacuna: se o painel já se viu rodando dentro do painel
 * lateral neste navegador, a extensão existe. Se depois disso ela para de
 * responder numa aba comum, é porque é antiga.
 *
 * `localStorage` é por perfil do Chrome, que é exatamente a granularidade
 * certa: extensão no Chrome também é por perfil. Pode falhar (janela anônima,
 * dados limpos, cookie de terceiro bloqueado) — e falhar aqui só devolve o
 * comportamento de antes, que é não avisar. Nunca o contrário.
 */
const CHAVE_MEMORIA = 'painel:usa-extensao';

function lembrarQueUsaExtensao() {
  try { localStorage.setItem(CHAVE_MEMORIA, '1'); } catch { /* sem memória, sem problema */ }
}

function jaUsouExtensao(): boolean {
  try { return localStorage.getItem(CHAVE_MEMORIA) === '1'; } catch { return false; }
}

/** Compara "1.1.0" com "1.0.0" sem depender de biblioteca. */
function versaoAtende(versao: string, minima: string): boolean {
  const a = versao.split('.').map((n) => Number(n) || 0);
  const b = minima.split('.').map((n) => Number(n) || 0);
  for (let i = 0; i < Math.max(a.length, b.length); i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    if (x !== y) return x > y;
  }
  return true;
}

/**
 * Pergunta à extensão quem ela é.
 *
 * A extensão anterior a 1.1.0 não declara `externally_connectable`, então ela
 * nem recebe a pergunta — o silêncio DELA é a resposta, e é por isso que
 * `dentroDoPainelLateral()` precisa entrar na conta.
 */
export function estadoDaExtensao(): Promise<Exclude<EstadoDaExtensao, 'verificando'>> {
  const noPainelLateral = dentroDoPainelLateral();
  if (noPainelLateral) lembrarQueUsaExtensao();

  /** Não respondeu: é antiga se sabemos que ela existe, ausente se não sabemos. */
  const semResposta = (): Exclude<EstadoDaExtensao, 'verificando'> =>
    noPainelLateral || jaUsouExtensao() ? 'antiga' : 'ausente';

  const runtime = extensao();
  const enviar = runtime?.sendMessage;

  if (!runtime || !enviar) return Promise.resolve(semResposta());

  return new Promise((resolver) => {
    let respondido = false;
    const terminar = (v: Exclude<EstadoDaExtensao, 'verificando'>) => {
      if (respondido) return;
      respondido = true;
      resolver(v);
    };
    const relogio = setTimeout(() => terminar(semResposta()), 1200);

    try {
      enviar(ID_DA_EXTENSAO, { tipo: 'versao' }, (r) => {
        clearTimeout(relogio);
        if (runtime.lastError || !r?.ok || !r.versao) { terminar(semResposta()); return; }
        // Respondeu: a extensão existe. Vale lembrar mesmo numa aba comum.
        lembrarQueUsaExtensao();
        terminar(versaoAtende(r.versao, VERSAO_MINIMA) ? 'atual' : 'antiga');
      });
    } catch {
      clearTimeout(relogio);
      terminar(semResposta());
    }
  });
}
