'use client';

import { useState } from 'react';
import { ChevronDown, ExternalLink, LifeBuoy, ScrollText } from 'lucide-react';
import { Cartao, cx } from '@/components/ui';

/**
 * Os 13 casos de docs/03-OPERACAO.md §6, com a resposta pronta para copiar e
 * qual botão marcar. Fica na lateral porque o atendente consulta no meio da
 * conversa — tirar do fluxo obrigaria a decorar 13 respostas.
 */
type Caso = { quando: string; responda?: string; marque?: string };

const CASOS: Caso[] = [
  { quando: '"Pode" / "manda" / "sim"', responda: undefined, marque: 'Autorizou (o painel entrega o material)' },
  { quando: '"Não" / "não quero" / "para"', marque: 'Pediu saída' },
  // A resposta certa depende de onde a pessoa veio, e quem sabe isso é o
  // painel: a etiqueta no alto do cartão diz "Lista fria" ou "Cadastrou no
  // site". Responder "foi um apoiador" a quem preencheu o formulário é dizer
  // à dona do dado uma coisa que não aconteceu.
  { quando: '"Quem te passou meu número?"',
    responda: 'Confira a etiqueta do contato. Lista fria: "Foi um apoiador que tem seu contato." Cadastrou no site ou Pediu o kit: "Você mesmo deixou no site, pedindo o material." Nos dois casos: "Se preferir, apago seu número agora."',
    marque: 'Se pedir para sair: Pediu saída' },
  { quando: '"Já voto em outro"',
    responda: 'Tudo bem, respeito. Vou tirar seu contato da lista.',
    marque: 'Pediu saída — e NÃO anote em quem a pessoa vota' },
  { quando: '"Quem é o candidato? O que defende?"', marque: 'Autorizou (manda o material)' },
  { quando: '"Número errado" / "não sou eu"',
    responda: 'Desculpa pelo engano, vou tirar da lista.',
    marque: 'Número inválido' },
  { quando: 'Quer ajudar, ser voluntário, quer adesivo',
    responda: 'Que ótimo! Posso passar seu contato pra coordenação te chamar?',
    marque: 'Quer ajudar' },
  { quando: 'Pediu emprego, dinheiro, cesta, favor',
    responda: 'Isso eu não posso prometer, e a lei não permite. O que posso é levar sua pergunta pra equipe, tudo bem?',
    marque: 'Encaminhar — nunca prometa nada' },
  { quando: 'Xingou', responda: 'Não responda. Não tire print.', marque: 'Pediu saída' },
  { quando: 'Onde voto / título / horário',
    responda: 'Dá pra conferir no site oficial do TSE: tse.jus.br',
    marque: '—' },
  { quando: 'Não respondeu', responda: 'Não faça nada. O sistema fecha sozinho em 72h.', marque: '—' },
  { quando: 'Respondeu dias depois', responda: 'Abra por "Meus contatos".', marque: '—' },
  { quando: 'Pediu para entrar no grupo',
    responda: 'Use o botão de convite ao canal. NUNCA adicione ninguém na mão.',
    marque: '—' },
];

function Copiar({ texto }: { texto: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        await navigator.clipboard.writeText(texto);
        setCopiado(true);
        setTimeout(() => setCopiado(false), 1500);
      }}
      className="mt-1 text-xs font-medium text-acento hover:underline"
    >
      {copiado ? 'copiado ✓' : 'copiar resposta'}
    </button>
  );
}

/**
 * ⚠️ Este bloco é consultado NO MEIO de uma conversa, com a pessoa esperando
 * resposta do outro lado. Duas coisas se aprenderam vendo o painel em uso:
 *
 * 1. Ele não parecia clicável. Era um retângulo com um título e um texto cinza
 *    à direita — igual ao cartão de regras logo acima, que é só leitura. Quem
 *    não soubesse que abre, não abria. Agora tem seta, muda no hover e o
 *    cursor vira mãozinha.
 *
 * 2. Ele não parecia importante. Fechado, dizia "Como agir · 13 casos", o que
 *    não conta para que serve. Agora diz o que tem dentro — resposta pronta
 *    para o que a pessoa acabar de escrever — e leva o acento da campanha,
 *    porque é a única coisa da lateral que se USA em vez de ler.
 */
export function ComoAgir({ rotaScript }: { rotaScript: string }) {
  const [aberto, setAberto] = useState(false);

  return (
    <Cartao className="overflow-hidden">
      {/*
        ⚠️ O roteiro NÃO entra nesta sanfona, e não é preguiça de layout.
        São quinze blocos com o texto inteiro de cada resposta; abertos dentro
        de uma coluna de 340px eles empurrariam o contato para fora da tela no
        momento em que a pessoa está esperando resposta. Em aba própria, ele
        fica aberto o turno inteiro ao lado do WhatsApp Web — que é como o
        atendente já trabalha (docs/03-OPERACAO.md §2).

        `rel="noopener"` porque `target="_blank"` sem ele dá à aba nova acesso
        a `window.opener`.
      */}
      <a
        href={rotaScript}
        target="_blank"
        rel="noopener"
        className={cx(
          'flex w-full items-start gap-3 border-b border-borda px-4 py-3.5 text-left',
          'transition-colors hover:bg-superficie-alta',
        )}
      >
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-acento/12 text-acento">
          <ScrollText size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Roteiro da conversa</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-suave">
            Do “oi” até depois da eleição, com o texto pronto de cada passo. Abre numa aba nova.
          </span>
        </span>
        <ExternalLink size={14} className="mt-1 shrink-0 text-suave" />
      </a>

      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className={cx(
          'flex w-full cursor-pointer items-start gap-3 px-4 py-3.5 text-left',
          'transition-colors hover:bg-superficie-alta',
        )}
        aria-expanded={aberto}
      >
        <span className="mt-0.5 grid size-7 shrink-0 place-items-center rounded-lg bg-acento/12 text-acento">
          <LifeBuoy size={15} />
        </span>

        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Como agir</span>
          <span className="mt-0.5 block text-xs leading-relaxed text-suave">
            {aberto
              ? 'Toque para esconder'
              : `Resposta pronta para os ${CASOS.length} casos mais comuns`}
          </span>
        </span>

        <ChevronDown
          size={16}
          className={cx(
            'mt-1 shrink-0 text-suave transition-transform duration-200',
            aberto && 'rotate-180',
          )}
        />
      </button>

      {aberto && (
        <ol className="divide-y divide-borda border-t border-borda">
          {CASOS.map((c, i) => (
            <li key={c.quando} className="px-4 py-3">
              <p className="text-sm font-medium">
                <span className="mr-1.5 text-suave">{i + 1}.</span>
                {c.quando}
              </p>
              {c.responda && (
                <>
                  <p className="mt-1 rounded-md bg-fundo px-2.5 py-1.5 text-xs text-suave">{c.responda}</p>
                  <Copiar texto={c.responda} />
                </>
              )}
              {c.marque && c.marque !== '—' && (
                <p className="mt-1.5 text-xs font-medium text-acento">→ {c.marque}</p>
              )}
            </li>
          ))}
        </ol>
      )}
    </Cartao>
  );
}
