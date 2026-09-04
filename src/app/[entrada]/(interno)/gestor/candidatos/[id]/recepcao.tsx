'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { MessageCircle, Plus, Power, X } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, AreaTexto, Pilula, Selecao, cx } from '@/components/ui';
import { formatarExibicao } from '@/lib/telefone';
import {
  MENSAGEM_RECEPCAO_PADRAO, montarMensagemRecepcao,
  problemaNaMensagemRecepcao, TEXTO_PROBLEMA_RECEPCAO, VARIAVEIS_RECEPCAO,
} from '@/lib/recepcao';
import {
  acrescentarNumeroRecepcao, alternarNumeroRecepcao,
  removerNumeroRecepcao, salvarMensagemRecepcao,
} from './acoes-recepcao';

export type NumeroDaRecepcao = {
  id: string;
  rotulo: string;
  numero_e164: string;
  atendente_id: string | null;
  peso: number;
  ativo: boolean;
  sorteios: number;
};

/**
 * Para onde vai a pessoa depois de preencher o formulário.
 *
 * ⚠️ O sistema não manda mensagem nenhuma aqui. Ele abre o WhatsApp DA PESSOA
 * com o texto escrito, e ela aperta enviar — a mensagem sai do aparelho dela
 * para a campanha. É entrada, não saída, e é o que mantém isto fora da
 * definição de disparo automático (CLAUDE.md, primeiro princípio). Se um dia
 * alguém quiser "só automatizar o envio", é aqui que a linha é cruzada.
 */
export function RecepcaoNoWhatsapp({
  candidatoId, nomeUrna, numeros, equipe, mensagem, reservaHoras,
}: {
  candidatoId: string;
  nomeUrna: string;
  numeros: NumeroDaRecepcao[];
  equipe: { id: string; primeiro_nome: string }[];
  mensagem: string | null;
  /** Quanto tempo o dono do número segura o contato. Vem da Configuração. */
  reservaHoras: number;
}) {
  const [texto, setTexto] = useState(mensagem ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const ativos = numeros.filter((n) => n.ativo);
  const problema = problemaNaMensagemRecepcao(texto);
  const somaPesos = ativos.reduce((s, n) => s + n.peso, 0);

  function agir(acao: () => Promise<{ ok: true } | { ok: false; erro: string }>) {
    iniciar(async () => {
      const r = await acao();
      if (r.ok) { setErro(null); router.refresh(); } else setErro(r.erro);
    });
  }

  return (
    <Cartao className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <MessageCircle size={16} className="text-suave" /> Recepção no WhatsApp
      </h2>
      <p className="mb-4 mt-0.5 text-xs leading-relaxed text-suave">
        Depois de preencher o formulário, a pessoa é levada a um destes números com uma
        mensagem já escrita — <strong className="text-texto">ela é quem aperta enviar</strong>.
        Serve para o número receber conversa de verdade, que é o que o WhatsApp mais olha.
      </p>

      {ativos.length === 0 ? (
        <Aviso tom="alerta" className="mb-4">
          Nenhum número ativo. Quem preencher o formulário de {nomeUrna} vê só a tela de
          obrigado, como antes — nada quebra.
        </Aviso>
      ) : (
        <p className="mb-3 text-xs text-suave">
          {ativos.length === 1
            ? 'Tudo vai para o único número ativo.'
            : `Os cadastros se dividem entre ${ativos.length} números, por rodízio — `
              + `${ativos.map((n) => porcento(n.peso, somaPesos)).join(' / ')}.`}
        </p>
      )}

      {numeros.length > 0 && (
        <ul className="mb-4 space-y-2">
          {numeros.map((n) => (
            <li key={n.id}
                className={cx(
                  'flex flex-wrap items-center gap-2.5 rounded-xl border px-3.5 py-2.5',
                  n.ativo ? 'border-borda bg-superficie-alta' : 'border-borda bg-transparent opacity-55',
                )}>
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-semibold">{n.rotulo}</p>
                <p className="truncate font-mono text-xs text-suave">
                  {formatarExibicao(n.numero_e164)}
                  {n.atendente_id && ` · ${nomeDe(equipe, n.atendente_id)}`}
                </p>
              </div>

              {n.peso > 1 && <Pilula cor="acento">peso {n.peso}</Pilula>}
              <span className="text-xs text-tenue">{n.sorteios}×</span>

              <button type="button" disabled={ocupado}
                      title={n.ativo ? 'Tirar do rodízio' : 'Voltar ao rodízio'}
                      className={cx('grid size-7 place-items-center rounded-lg border transition-colors',
                        n.ativo
                          ? 'border-acento/40 bg-acento/15 text-acento'
                          : 'border-borda text-tenue hover:text-suave')}
                      onClick={() => agir(() => alternarNumeroRecepcao(n.id, !n.ativo))}>
                <Power size={13} />
              </button>

              <button type="button" disabled={ocupado} title="Apagar"
                      className="text-suave hover:text-perigo"
                      onClick={() => agir(() => removerNumeroRecepcao(n.id))}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {erro && <Aviso tom="erro" className="mb-4">{erro}</Aviso>}

      {/* ── acrescentar ─────────────────────────────────────────────────── */}
      <form
        action={(form) => agir(() => acrescentarNumeroRecepcao(candidatoId, form))}
        className="mb-5 grid gap-3 rounded-xl border border-borda p-3.5 sm:grid-cols-2"
      >
        <Campo rotulo="Nome" name="rotulo" required placeholder="Vitor — Principal" />
        <Campo rotulo="Número" name="numero" required inputMode="tel" placeholder="(69) 99999-0000" />
        <Selecao rotulo="De quem é" name="atendente_id"
                 dica={reservaHoras > 0
                   ? `Quem cair aqui fica ${reservaHoras}h reservado para essa pessoa.`
                   : 'A reserva está desligada na Configuração.'}>
          <option value="">Ninguém do painel</option>
          {equipe.map((a) => <option key={a.id} value={a.id}>{a.primeiro_nome}</option>)}
        </Selecao>
        <Campo rotulo="Peso" name="peso" type="number" min={1} max={10} defaultValue={1}
               dica="1 é o normal. 2 recebe o dobro dos outros." />
        <div className="sm:col-span-2">
          <Botao tamanho="p" type="submit" disabled={ocupado}>
            <Plus size={13} /> Acrescentar número
          </Botao>
        </div>
      </form>

      {/* ── a mensagem ──────────────────────────────────────────────────── */}
      <AreaTexto
        rotulo="A mensagem que ela vai enviar"
        rows={3}
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setSalvo(false); }}
        placeholder={MENSAGEM_RECEPCAO_PADRAO}
        className={cx(problema && 'border-perigo')}
        dica={problema
          ? TEXTO_PROBLEMA_RECEPCAO[problema]
          : 'Vazio usa a padrão. Quem escreve é o eleitor, então nada de CNPJ nem "pode sair" aqui.'}
      />

      <p className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-[11px] text-tenue">
        {VARIAVEIS_RECEPCAO.map(([v, oque]) => (
          <span key={v}><code className="text-suave">{v}</code> {oque}</span>
        ))}
      </p>

      <div className="mt-3 rounded-xl border border-borda bg-superficie-alta px-3.5 py-3">
        <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
          Como vai chegar
        </p>
        <p className="text-sm leading-relaxed">
          {montarMensagemRecepcao(texto, {
            nome: 'Maria Silva', primeiroNome: 'Maria',
            cidade: 'Porto Velho', candidato: nomeUrna, itens: ['camiseta'],
          })}
        </p>
      </div>

      <div className="mt-3 flex items-center gap-3">
        <Botao tamanho="p" variante="neutro" disabled={ocupado || Boolean(problema)}
               onClick={() => iniciar(async () => {
                 const r = await salvarMensagemRecepcao(candidatoId, texto);
                 if (r.ok) { setErro(null); setSalvo(true); router.refresh(); } else setErro(r.erro);
               })}>
          Salvar a mensagem
        </Botao>
        {salvo && <span className="text-xs text-ok">salvo</span>}
      </div>
    </Cartao>
  );
}

function nomeDe(equipe: { id: string; primeiro_nome: string }[], id: string): string {
  return equipe.find((a) => a.id === id)?.primeiro_nome ?? 'fora do painel';
}

/** "50%" — arredondado, só para o gestor conferir a divisão de relance. */
function porcento(peso: number, soma: number): string {
  return `${Math.round((peso / soma) * 100)}%`;
}
