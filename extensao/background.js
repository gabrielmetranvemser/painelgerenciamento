// Clicar no ícone da extensão abre o painel lateral.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((erro) => console.error('painel lateral:', erro));

/**
 * Abrir a conversa NA ABA DE WHATSAPP QUE JÁ ESTÁ ABERTA.
 *
 * ⚠️ POR QUE ISTO PRECISA DE EXTENSÃO
 *
 * O painel é uma página web. Uma página só consegue reaproveitar uma aba que
 * ELA MESMA abriu, pelo nome da janela em `window.open`. A aba de WhatsApp que
 * o atendente abriu por conta própria não tem esse nome, então cada conversa
 * abria uma aba NOVA ao lado — e no meio de trinta atendimentos isso vira uma
 * fileira de abas de WhatsApp Web, cada uma carregando de novo.
 *
 * A extensão enxerga as abas do navegador e resolve o problema na raiz: acha a
 * aba de WhatsApp que existe, manda ela para o endereço da conversa e traz para
 * a frente. Uma aba, sempre a mesma.
 *
 * ⚠️ O QUE ISTO **NÃO** FAZ, E NÃO PODE FAZER
 *
 * Não injeta script no WhatsApp, não lê a conversa, não clica em nada e não
 * envia mensagem. O que ela faz é trocar o ENDEREÇO da aba pelo mesmo link
 * `web.whatsapp.com/send?phone=…&text=…` que o painel já usava — o link
 * oficial, que abre o chat com o texto preenchido e para aí. Quem revisa e
 * aperta enviar continua sendo a pessoa.
 *
 * Automatizar o envio é vedado neste projeto (ver docs/01-VISAO-GERAL.md §2):
 * no instante em que o software dispara, deixa de ser "conversa entre pessoas"
 * e vira "disparo em massa". Por isso a permissão pedida é `tabs`, e não
 * `scripting` — a extensão não tem como tocar no conteúdo da página, nem por
 * engano, nem depois.
 */
const WHATSAPP = 'https://web.whatsapp.com/*';

chrome.runtime.onMessageExternal.addListener((mensagem, _remetente, responder) => {
  if (!mensagem || mensagem.tipo !== 'abrir-conversa' || typeof mensagem.url !== 'string') {
    responder({ ok: false, motivo: 'mensagem_desconhecida' });
    return false;
  }

  // Só endereços do WhatsApp. Sem esta conferência, qualquer página que
  // soubesse o id da extensão poderia usá-la para abrir o que quisesse.
  if (!mensagem.url.startsWith('https://web.whatsapp.com/')) {
    responder({ ok: false, motivo: 'endereco_recusado' });
    return false;
  }

  chrome.tabs.query({ url: WHATSAPP }, (abas) => {
    if (chrome.runtime.lastError || !abas || abas.length === 0) {
      // Nenhuma aberta: abre uma, que passa a ser A aba dali em diante.
      chrome.tabs.create({ url: mensagem.url, active: true }, (aba) => {
        responder({ ok: true, criou: true, abaId: aba?.id ?? null });
      });
      return;
    }

    // A que estiver em primeiro plano tem preferência; senão, a primeira.
    const alvo = abas.find((a) => a.active) ?? abas[0];
    chrome.tabs.update(alvo.id, { url: mensagem.url, active: true }, () => {
      if (alvo.windowId != null) chrome.windows.update(alvo.windowId, { focused: true });
      responder({ ok: true, criou: false, abaId: alvo.id });
    });
  });

  // `true` mantém o canal aberto: as respostas acima são assíncronas.
  return true;
});
