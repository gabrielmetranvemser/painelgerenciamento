const quadro = document.getElementById('quadro');
const socorro = document.getElementById('socorro');
const abrirAba = document.getElementById('abrirAba');

quadro.src = globalThis.PAINEL_URL;
abrirAba.href = globalThis.PAINEL_URL;

document.getElementById('fechar').addEventListener('click', () => {
  socorro.hidden = true;
});

// Dentro do painel lateral, a página de topo é a extensão, então o painel roda
// como conteúdo de terceiro. Se a máquina tiver cookie de terceiro bloqueado, a
// sessão não sobe e o atendente ficaria olhando uma tela de login que não
// entra. Este aviso dá a saída imediata: usar o painel numa aba normal, que
// funciona sempre.
setTimeout(() => { socorro.hidden = false; }, 6000);
quadro.addEventListener('load', () => {
  // Só some se carregou rápido — se demorou, provavelmente algo está errado.
  setTimeout(() => { socorro.hidden = true; }, 500);
}, { once: true });
