'use client';

import { useState } from 'react';

/**
 * Os 13 casos de docs/03-OPERACAO.md §6, com a resposta pronta para copiar e
 * qual botão marcar. Fica na lateral porque o atendente consulta no meio da
 * conversa — tirar do fluxo obrigaria a decorar 13 respostas.
 */
type Caso = { quando: string; responda?: string; marque?: string };

const CASOS: Caso[] = [
  { quando: '"Pode" / "manda" / "sim"', responda: undefined, marque: 'Autorizou (o painel entrega o material)' },
  { quando: '"Não" / "não quero" / "para"', marque: 'Pediu saída' },
  { quando: '"Quem te passou meu número?"',
    responda: 'Foi um apoiador que tem seu contato. Se preferir, apago seu número agora e não te chamo mais.',
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

export function ComoAgir() {
  const [aberto, setAberto] = useState(false);

  return (
    <section className="rounded-xl border border-borda bg-superficie">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        className="flex w-full items-center justify-between px-4 py-3 text-left"
        aria-expanded={aberto}
      >
        <span className="text-sm font-semibold">Como agir</span>
        <span className="text-xs text-suave">{aberto ? 'esconder' : `${CASOS.length} casos`}</span>
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
    </section>
  );
}
