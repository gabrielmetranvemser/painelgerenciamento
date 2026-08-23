'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { MousePointerClick, PackageOpen, Search } from 'lucide-react';
import { Cartao, EtiquetaOrigem, Pilula, Selecao, cx } from '@/components/ui';
import { formatarExibicao } from '@/lib/telefone';
import type {
  Candidato, ContatoDoGestor, Municipio, StatusContato, Usuario,
} from '@/lib/tipos-banco';

const ROTULO_STATUS: Record<StatusContato, string> = {
  novo: 'Novo',
  na_fila: 'Na fila',
  em_atendimento: 'Aguardando resposta',
  autorizou: 'Autorizou',
  pediu_saida: 'Pediu saída',
  invalido: 'Número inválido',
  quer_ajudar: 'Quer ajudar',
  encaminhado: 'Encaminhado',
  sem_resposta: 'Não respondeu',
  perdido: 'Perdido',
};

const COR_STATUS: Record<StatusContato, 'neutro' | 'acento' | 'quente' | 'frio' | 'alerta' | 'perigo'> = {
  novo: 'neutro',
  na_fila: 'frio',
  em_atendimento: 'alerta',
  autorizou: 'acento',
  pediu_saida: 'perigo',
  invalido: 'neutro',
  quer_ajudar: 'acento',
  encaminhado: 'quente',
  sem_resposta: 'neutro',
  perdido: 'neutro',
};

/**
 * Atalhos de leitura, na ordem em que o gestor pergunta.
 *
 * "Pendente" não é um status do banco: é a pergunta que o gestor faz de manhã —
 * quem já foi chamado e ainda não deu resposta. No banco isso é
 * `em_atendimento` com a primeira mensagem já enviada.
 */
const RECORTES = [
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'pendentes', rotulo: 'Aguardando resposta' },
  { chave: 'na_fila', rotulo: 'Ainda não chamados' },
  { chave: 'autorizou', rotulo: 'Autorizaram' },
  { chave: 'pediu_saida', rotulo: 'Pediram saída' },
  { chave: 'kit', rotulo: 'Kit a entregar' },
] as const;

type Recorte = (typeof RECORTES)[number]['chave'];

function passaNoRecorte(c: ContatoDoGestor, r: Recorte) {
  switch (r) {
    case 'pendentes':  return c.status === 'em_atendimento' && c.primeiro_contato_em !== null;
    case 'na_fila':    return c.status === 'na_fila';
    case 'autorizou':  return c.status === 'autorizou';
    case 'pediu_saida':return c.status === 'pediu_saida';
    case 'kit':        return c.kit_pendente;
    default:           return true;
  }
}

const dataHora = (iso: string | null) =>
  iso ? new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' }) : '—';

export function TabelaContatos({
  contatos, atendentes, candidatos, municipios, entrada,
  atendenteInicial = '', recorteInicial = 'todos',
}: {
  contatos: ContatoDoGestor[];
  atendentes: Usuario[];
  candidatos: Candidato[];
  municipios: Municipio[];
  entrada: string;
  /** Vem do link de Relatórios, para cair aqui já filtrado. */
  atendenteInicial?: string;
  recorteInicial?: Recorte;
}) {
  const [recorte, setRecorte] = useState<Recorte>(recorteInicial);
  const [atendente, setAtendente] = useState(atendenteInicial);
  const [candidato, setCandidato] = useState('');
  const [municipio, setMunicipio] = useState('');
  const [origem, setOrigem] = useState('');
  const [busca, setBusca] = useState('');

  const visiveis = useMemo(() => {
    const t = busca.trim().toLowerCase();
    const digitos = t.replace(/\D/g, '');
    return contatos.filter((c) =>
      passaNoRecorte(c, recorte) &&
      (!atendente || c.atendente_id === atendente) &&
      (!candidato || c.candidato_origem_id === candidato) &&
      (!municipio || String(c.municipio_id) === municipio) &&
      (!origem || c.origem === origem) &&
      (!t ||
        (c.nome ?? '').toLowerCase().includes(t) ||
        (digitos.length >= 4 && (c.telefone_e164 ?? '').includes(digitos))),
    );
  }, [contatos, recorte, atendente, candidato, municipio, origem, busca]);

  const contagem = (r: Recorte) => contatos.filter((c) => passaNoRecorte(c, r)).length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-1.5">
        {RECORTES.map((r) => (
          <button key={r.chave} type="button" onClick={() => setRecorte(r.chave)}
                  className={cx(
                    'rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                    recorte === r.chave ? 'bg-texto text-fundo' : 'text-suave hover:bg-superficie-alta hover:text-texto',
                  )}>
            {r.rotulo} <span className="tabular-nums opacity-60">{contagem(r.chave)}</span>
          </button>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <label className="relative">
          <Search size={14} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-tenue" />
          <input value={busca} onChange={(e) => setBusca(e.target.value)}
                 placeholder="nome ou telefone"
                 className="w-52 rounded-full border border-borda bg-superficie-alta py-2 pl-9 pr-4 text-sm placeholder:text-tenue" />
        </label>

        <Selecao compacto value={atendente} onChange={(e) => setAtendente(e.target.value)}
                 aria-label="Filtrar por atendente">
          <option value="">Todos os atendentes</option>
          {atendentes.map((a) => <option key={a.id} value={a.id}>{a.primeiro_nome}</option>)}
        </Selecao>

        <Selecao compacto value={candidato} onChange={(e) => setCandidato(e.target.value)}
                 aria-label="Filtrar por candidato de origem">
          <option value="">Toda origem de candidato</option>
          {candidatos.map((c) => <option key={c.id} value={c.id}>{c.nome_urna}</option>)}
        </Selecao>

        <Selecao compacto value={origem} onChange={(e) => setOrigem(e.target.value)}
                 aria-label="Filtrar por origem">
          <option value="">Fria e quente</option>
          <option value="site">Cadastrou no site</option>
          <option value="kit">Pediu o kit</option>
          <option value="lista_fria">Lista fria</option>
        </Selecao>

        <Selecao compacto value={municipio} onChange={(e) => setMunicipio(e.target.value)}
                 aria-label="Filtrar por cidade">
          <option value="">Todas as cidades</option>
          {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </Selecao>

        <span className="ml-auto text-xs text-suave">
          {visiveis.length.toLocaleString('pt-BR')} de {contatos.length.toLocaleString('pt-BR')}
        </span>
      </div>

      {visiveis.length === 0 ? (
        <Cartao className="px-6 py-10 text-center text-sm text-suave">Nada com esses filtros.</Cartao>
      ) : (
        <Cartao className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead>
              <tr className="border-b border-borda text-left">
                {['Pessoa', 'Origem', 'Situação', 'Atendente', 'Falou em', 'Msgs', 'Cliques', ''].map((h, i) => (
                  <th key={h || i}
                      className={cx('px-4 py-2.5 text-xs font-medium text-suave',
                        i >= 5 && i <= 6 && 'text-right')}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-borda">
              {visiveis.slice(0, 500).map((c) => (
                <tr key={c.id} className="transition-colors hover:bg-superficie-alta/60">
                  <td className="px-4 py-2.5">
                    <p className="font-medium">
                      {c.nome ?? <span className="text-tenue">(dados apagados)</span>}
                    </p>
                    <p className="text-xs text-suave">
                      {c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '—'}
                      {c.municipio && ` · ${c.municipio}`}
                    </p>
                  </td>
                  <td className="px-4 py-2.5">
                    <EtiquetaOrigem origem={c.origem} />
                    {c.candidato_origem && (
                      <p className="mt-1 text-xs text-suave">via {c.candidato_origem}</p>
                    )}
                  </td>
                  <td className="px-4 py-2.5">
                    <Pilula cor={COR_STATUS[c.status]}>{ROTULO_STATUS[c.status]}</Pilula>
                    {c.kit_pendente && (
                      <p className="mt-1 inline-flex items-center gap-1 text-xs text-alerta">
                        <PackageOpen size={11} /> kit a entregar
                      </p>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-suave">
                    {c.atendente ?? '—'}
                    {c.chip && <span className="block text-xs text-tenue">{c.chip}</span>}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-suave">{dataHora(c.primeiro_contato_em)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{c.mensagens}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums">
                    {c.cliques > 0
                      ? <span className="inline-flex items-center gap-1 text-acento">
                          <MousePointerClick size={12} />{c.cliques}
                        </span>
                      : <span className="text-tenue">0</span>}
                  </td>
                  <td className="px-4 py-2.5 text-right">
                    <Link href={`/${entrada}/painel/contatos/${c.id}`}
                          className="text-xs text-suave underline-offset-4 hover:text-texto hover:underline">
                      abrir
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {visiveis.length > 500 && (
            <p className="border-t border-borda px-4 py-3 text-xs text-suave">
              Mostrando as 500 primeiras de {visiveis.length.toLocaleString('pt-BR')}. Refine o
              filtro, ou baixe o CSV para a lista inteira.
            </p>
          )}
        </Cartao>
      )}
    </div>
  );
}
