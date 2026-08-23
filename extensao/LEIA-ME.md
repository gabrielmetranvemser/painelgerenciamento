# Painel lateral (extensão do Chrome)

Coloca o painel de atendimento numa barra fixa na lateral do navegador, ao lado
do WhatsApp Web. O atendente para de alternar entre abas trinta vezes por dia.

## O que ela NÃO faz

Não lê, não toca e não injeta nada no WhatsApp Web. Não tem sequer permissão
para isso — o `manifest.json` pede uma permissão só, `sidePanel`. Ela apenas
exibe o mesmo painel que já roda no navegador, dentro de um quadro.

Isso é intencional: é o que a torna invisível para a Meta e o que faz a revisão
da Chrome Web Store passar sem levantar bandeira. Ler a tela do WhatsApp
economizaria alguns segundos por contato e custaria a violação dos termos, além
de quebrar toda vez que a Meta mudasse a página — possivelmente na semana da
eleição.

**A extensão é conforto, não requisito.** Sem ela o painel funciona 100% numa
aba comum ao lado do WhatsApp Web.

## Antes de distribuir

Edite **um único arquivo**, `config.js`, com o endereço do painel:

```js
globalThis.PAINEL_URL = 'https://painel.SEUDOMINIO.com.br/painel';
```

## Instalar nas máquinas (enquanto a loja não aprova)

1. Abrir `chrome://extensions`
2. Ligar **Modo do desenvolvedor** (canto superior direito)
3. **Carregar sem compactação** e escolher esta pasta
4. Fixar o ícone na barra e clicar nele para abrir o painel

O Chrome exibe um aviso de extensão em modo desenvolvedor. É chato com 15
máquinas, mas funciona.

## Publicar na Chrome Web Store

Publique como **não listada**: só quem tem o link instala. A revisão leva de
dias a mais de uma semana — **submeta cedo**.

O `manifest.json` já traz o campo `key`, então o ID da extensão é sempre o
mesmo (`pdpffmibfeikfffdbpfklhdkifmceden`), na instalação manual e na loja. Não
remova esse campo: o site libera o enquadramento só para esse ID, e trocá-lo faz
o painel parar de abrir na lateral.

Se precisar mesmo trocar a chave, defina `EXTENSAO_ID` nas variáveis de ambiente
da Vercel com o ID novo.

## Se o painel abrir na tela de login e não entrar

É cookie de terceiro bloqueado naquela máquina. Dentro do painel lateral a
página de topo é a extensão, então o painel conta como conteúdo de terceiro.

Saída imediata: usar o link **"Abrir em uma aba"**, que aparece no rodapé do
painel. A aba comum funciona sempre.

Saída definitiva: liberar cookies para o domínio do painel em
`chrome://settings/cookies`, ou por política gerenciada nas máquinas da campanha.
