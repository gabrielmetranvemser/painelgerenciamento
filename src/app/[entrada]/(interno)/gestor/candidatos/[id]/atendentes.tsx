'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Headphones, Plus, Star, X } from 'lucide-react';
import { Aviso, Botao, Cartao, Pilula, Selecao } from '@/components/ui';
import {
  atribuirCandidato, definirPrincipal, removerDaChapa,
} from '@/app/[entrada]/(interno)/gestor/atendentes/chapa';

export type AtendenteDoCandidato = {
  id: string;
  primeiro_nome: string;
  ativo: boolean;
  papel: 'gestor' | 'atendente';
  principal: boolean;
};

/**
 * Quem atende esta candidatura.
 *
 * A mesma tabela que a "chapa do atendente" — vista do outro lado. Existem as
 * duas porque as duas perguntas são feitas de verdade: "de quem o Lucas fala?"
 * na tela do atendente, e "quem fala de mim?" aqui. Uma tela só obrigaria o
 * gestor a abrir os 15 atendentes para descobrir se alguém ficou sem este
 * candidato.
 *
 * As ações são as mesmas de lá. A regra de um candidato por cargo continua
 * sendo do banco, e a mensagem de erro vem pronta explicando quem já ocupa a
 * vaga naquele atendente.
 */
export function AtendentesDoCandidato({
  candidatoId, nomeUrna, atendentes, disponiveis, entrada,
}: {
  candidatoId: string;
  nomeUrna: string;
  atendentes: AtendenteDoCandidato[];
  disponiveis: { id: string; primeiro_nome: string; papel: 'gestor' | 'atendente' }[];
  entrada: string;
}) {
  const [escolhido, setEscolhido] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  return (
    <Cartao className="p-5">
      <h2 className="flex items-center gap-2 font-semibold">
        <Headphones size={16} className="text-suave" /> Quem atende {nomeUrna}
      </h2>
      <p className="mb-4 mt-0.5 text-xs leading-relaxed text-suave">
        Só quem está aqui pode mandar material desta candidatura — e só estes recebem os
        cadastros que chegam pela página dela.
      </p>

      {atendentes.length === 0 ? (
        <Aviso tom="alerta" className="mb-4">
          Ninguém atende {nomeUrna}. Os cadastros que chegarem pela página dela ficam parados na
          fila, sem ninguém para receber.
        </Aviso>
      ) : (
        <ul className="mb-4 space-y-2">
          {atendentes.map((a) => (
            <li key={a.id}
                className="flex flex-wrap items-center gap-2.5 rounded-xl border border-borda bg-superficie-alta px-3.5 py-2.5">
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-semibold">{a.primeiro_nome}</p>
                <p className="text-xs text-suave">
                  {a.papel === 'gestor' ? 'gestor' : 'atendente'}
                  {!a.ativo && ' · conta inativa'}
                </p>
              </div>

              {a.principal ? (
                <Pilula cor="acento"><Star size={11} /> cita na 1ª mensagem</Pilula>
              ) : (
                <button type="button" disabled={ocupado}
                        title="Passa a ser o citado no pedido de permissão deste atendente"
                        className="text-xs text-suave hover:text-texto"
                        onClick={() => iniciar(async () => {
                          const r = await definirPrincipal(a.id, candidatoId);
                          if (r.ok) { setErro(null); router.refresh(); } else setErro(r.erro);
                        })}>
                  tornar principal
                </button>
              )}

              <button type="button" disabled={ocupado} title="Tirar da chapa deste atendente"
                      className="text-suave hover:text-perigo"
                      onClick={() => iniciar(async () => {
                        await removerDaChapa(a.id, candidatoId);
                        setErro(null); router.refresh();
                      })}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      )}

      {erro && <Aviso tom="erro" className="mb-4">{erro}</Aviso>}

      {disponiveis.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2">
          <Selecao compacto value={escolhido} onChange={(e) => setEscolhido(e.target.value)}
                   aria-label="Atendente a acrescentar">
            <option value="">Acrescentar atendente…</option>
            {disponiveis.map((a) => (
              <option key={a.id} value={a.id}>
                {a.primeiro_nome}{a.papel === 'gestor' ? ' (gestor)' : ''}
              </option>
            ))}
          </Selecao>
          <Botao tamanho="p" disabled={!escolhido || ocupado}
                 onClick={() => iniciar(async () => {
                   const r = await atribuirCandidato(escolhido, candidatoId);
                   if (r.ok) { setEscolhido(''); setErro(null); router.refresh(); } else setErro(r.erro);
                 })}>
            <Plus size={13} /> Acrescentar
          </Botao>
        </div>
      ) : (
        <p className="text-xs text-suave">
          {atendentes.length === 0
            ? 'Não há nenhuma conta ativa para atribuir.'
            : `Todo mundo que está ativo já atende ${nomeUrna}.`}{' '}
          <Link href={`/${entrada}/gestor/atendentes`} className="underline underline-offset-4">
            Cadastrar atendente
          </Link>
        </p>
      )}
    </Cartao>
  );
}
