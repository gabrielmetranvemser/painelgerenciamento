// Clicar no ícone da extensão abre o painel lateral. É tudo o que ela faz.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((erro) => console.error('painel lateral:', erro));
