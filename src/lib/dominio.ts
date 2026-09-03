/**
 * O formato de um domínio próprio de candidato.
 *
 * ⚠️ Arquivo NEUTRO de propósito: sem `server-only` e sem `'use client'`. O
 * formulário do gestor precisa avisar enquanto ele digita, e o servidor precisa
 * recusar de verdade — as duas pontas usam esta mesma função, que é a única
 * maneira de as duas concordarem sobre o que é um domínio válido.
 *
 * O valor guardado é comparado byte a byte com o cabeçalho `Host` da
 * requisição. Por isso a normalização não é cosmética: "https://Material.Sofia
 * andrade.com.br/" e "material.sofiaandrade.com.br" são o mesmo endereço para
 * uma pessoa e endereços diferentes para o roteador. Guardar o primeiro é
 * guardar um domínio que nunca casa com visita nenhuma — e o sintoma seria o
 * pior tipo: tudo parece cadastrado, e o link simplesmente continua saindo no
 * endereço antigo sem ninguém entender por quê.
 */

/** Um rótulo de host: letra ou dígito nas pontas, hífen só no meio. */
const ROTULO = '[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?';
const HOST = new RegExp(`^${ROTULO}(?:\\.${ROTULO})+$`);

/**
 * Tira do que foi digitado tudo que não é o host: esquema, usuário, porta,
 * caminho, espaço e a barra final. Devolve `null` quando não sobra host.
 */
export function normalizarDominio(bruto: string | null | undefined): string | null {
  if (!bruto) return null;

  let t = bruto.trim().toLowerCase();
  if (!t) return null;

  // `https://`, `http://` ou só `//`.
  t = t.replace(/^[a-z][a-z0-9+.-]*:\/\//, '').replace(/^\/\//, '');
  // Credencial no endereço, que ninguém digita de propósito mas o copiar-colar traz.
  t = t.replace(/^[^@/]*@/, '');
  // Caminho, busca e âncora.
  t = t.split(/[/?#]/)[0];
  // Porta.
  t = t.split(':')[0];
  // Ponto final da forma absoluta ("exemplo.com.br.").
  t = t.replace(/\.+$/, '');

  return t || null;
}

export type ProblemaDominio = 'formato' | 'sufixo' | 'curto' | 'longo' | 'sem_subdominio';

export const TEXTO_PROBLEMA_DOMINIO: Record<ProblemaDominio, string> = {
  formato:
    'Escreva só o endereço, como material.exemplo.com.br — sem https://, sem barra e sem espaço.',
  sufixo: 'Falta a terminação do domínio (.com.br, .com, .org…).',
  curto: 'Endereço curto demais para ser um domínio.',
  longo: 'Endereço longo demais para ser um domínio.',
  sem_subdominio:
    'Use um subdomínio (material.exemplo.com.br) em vez do domínio principal. '
    + 'Apontar o domínio raiz para cá tiraria do ar o site que já existe nele.',
};

/**
 * O que está errado no host, ou `null` quando está certo.
 *
 * ⚠️ `sem_subdominio` é a regra que protege o que já existe. O portal do
 * candidato costuma morar no domínio raiz; apontá-lo para cá substituiria o
 * site dele pela página de captação. Este painel serve UMA página — não tem
 * como hospedar um portal — então aceitar a raiz seria oferecer um jeito de
 * derrubar o site da campanha por engano, num campo de texto, sem aviso.
 */
export function problemaNoDominio(host: string): ProblemaDominio | null {
  if (host.length < 4) return 'curto';
  if (host.length > 253) return 'longo';
  if (!HOST.test(host)) return 'formato';
  if (!/\.[a-z]{2,}$/.test(host)) return 'sufixo';

  // "exemplo.com.br" tem três rótulos e ainda é raiz; "exemplo.com" tem dois.
  // O que separa é o sufixo composto, e a lista pública dele é grande demais
  // para caber aqui — as terminações abaixo cobrem o que a campanha usa.
  const partes = host.split('.');
  const minimo = /\.(com|net|org|gov|edu|adv|art|eco|ind|inf|rec|srv|tur|vet)\.[a-z]{2}$/.test(host)
    ? 4
    : 3;
  if (partes.length < minimo) return 'sem_subdominio';

  return null;
}
