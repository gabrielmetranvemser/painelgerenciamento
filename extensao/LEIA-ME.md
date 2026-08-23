# Painel lateral (extensão do Chrome)

Coloca o painel de atendimento numa barra fixa na lateral do navegador, ao lado
do WhatsApp Web. O atendente para de alternar entre abas trinta vezes por dia.

**Distribuição: instalação manual em modo desenvolvedor, nas máquinas da
campanha.** Não vai para a Chrome Web Store — quanto menos superfície pública,
melhor, e a revisão da loja seria o caminho crítico mais longo do projeto.

## O que ela NÃO faz

Não lê, não toca e não injeta nada no WhatsApp Web. Não tem sequer permissão
para isso — o `manifest.json` pede uma permissão só, `sidePanel`. Ela apenas
exibe o mesmo painel que já roda no navegador, dentro de um quadro.

**A extensão é conforto, não requisito.** Sem ela o painel funciona 100% numa
aba comum ao lado do WhatsApp Web.

## ⚠️ Não remova o campo `key` do manifest

Sem a loja, ele fica **mais** importante, não menos.

Uma extensão carregada sem compactação normalmente ganha um ID derivado do
caminho da pasta — ou seja, um ID **diferente em cada máquina**. Com o campo
`key`, o Chrome deriva o ID da chave pública, e as 15 máquinas passam a ter o
mesmo:

```
pdpffmibfeikfffdbpfklhdkifmceden
```

Isso importa porque o site só autoriza esse ID a enquadrar o painel
(`frame-ancestors`, em `next.config.ts`). Se o `key` sumir, o painel lateral
abre em branco em todas as máquinas.

Se algum dia precisar trocar a chave, defina `EXTENSAO_ID` nas variáveis de
ambiente da Vercel com o ID novo.

## Não pegue esta pasta direto do repositório

Baixe o zip pela página **Preparar sua máquina** do painel. Ele é montado no
build com o endereço real já dentro do `config.js` — inclusive o segmento
secreto do painel, que não fica versionado aqui.

O nome do arquivo do zip também vem da chave do painel, e o download exige
sessão. Os dois cuidados existem pelo mesmo motivo: o zip carrega o endereço do
painel dentro dele, e num caminho previsível baixar o arquivo entregaria o
endereço para qualquer um.

## Instalar em cada máquina

1. Abrir `chrome://extensions`
2. Ligar **Modo do desenvolvedor** (canto superior direito)
3. **Carregar sem compactação** e escolher esta pasta
4. Fixar o ícone na barra e clicar nele para abrir o painel

A pasta precisa **ficar onde está** — o Chrome carrega os arquivos dali toda
vez que abre. Se a pasta for movida ou apagada, a extensão para de funcionar.
Coloque num lugar estável, por exemplo `C:\painel-extensao`.

O Chrome exibe um aviso de "extensão em modo desenvolvedor" a cada abertura.
É chato e não tem como desligar sem empacotar; é o preço de não publicar.

Para levar às máquinas: `npm run extensao:pacote` gera um `.zip` da pasta.

## Testar contra o localhost

O painel lateral roda o site como conteúdo de terceiro, então o cookie de
sessão precisa de `SameSite=None`. Em produção isso já vale. Para testar contra
o `localhost`, acrescente ao `.env.local` e reinicie o servidor:

```
PAINEL_LATERAL_LOCAL=1
```

E aponte o `config.js` para `http://localhost:3000/painel`.

## Se o painel abrir na tela de login e não entrar

É cookie de terceiro bloqueado naquela máquina.

Saída imediata: o link **"Abrir em uma aba"**, no rodapé do painel lateral.
A aba comum funciona sempre.

Saída definitiva: liberar cookies para o domínio do painel em
`chrome://settings/cookies`.
