'use client';

import Papa from 'papaparse';
import { useState, useTransition } from 'react';
import { Aviso, Botao, Campo, Cartao } from '@/components/ui';
import { analisarLinhas, emBlocos, sugerirMapa, type Analise, type MapaColunas } from '@/lib/importacao';
import type { OrigemContato } from '@/lib/tipos-banco';
import { conferirBloco, criarLista, finalizarLista, importarBloco } from './acoes';

const BLOCO = 500;

type Etapa = 'arquivo' | 'mapear' | 'conferir' | 'importando' | 'pronto';

type Conferencia = { jaExistem: number; bloqueados: number };
type Totais = { importados: number; duplicados: number; bloqueados: number };

const MOTIVO_LEGIVEL: Record<string, string> = {
  vazio: 'sem telefone',
  curto: 'dígitos de menos',
  longo: 'dígitos demais',
  ddd_invalido: 'DDD que não existe',
  fixo: 'telefone fixo (não tem WhatsApp)',
  formato: 'não parece celular brasileiro',
};

export function Importador() {
  const [etapa, setEtapa] = useState<Etapa>('arquivo');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  const [arquivo, setArquivo] = useState<File | null>(null);
  const [colunas, setColunas] = useState<string[]>([]);
  const [linhas, setLinhas] = useState<Record<string, string>[]>([]);
  const [mapa, setMapa] = useState<MapaColunas>({ nome: null, telefone: '', municipio: null });

  const [origem, setOrigem] = useState<OrigemContato>('lista_fria');
  const [rotulo, setRotulo] = useState('');
  const [entreguePor, setEntreguePor] = useState('');
  const [entregueEm, setEntregueEm] = useState(new Date().toISOString().slice(0, 10));

  const [analise, setAnalise] = useState<Analise | null>(null);
  const [conferencia, setConferencia] = useState<Conferencia | null>(null);
  const [progresso, setProgresso] = useState(0);
  const [totais, setTotais] = useState<Totais | null>(null);

  function lerArquivo(f: File) {
    setErro(null);
    setArquivo(f);
    setRotulo((r) => r || f.name.replace(/\.[^.]+$/, ''));

    Papa.parse<Record<string, string>>(f, {
      header: true,
      skipEmptyLines: 'greedy',
      complete: (res) => {
        const campos = res.meta.fields ?? [];
        if (campos.length === 0 || res.data.length === 0) {
          setErro('Não consegui ler nenhuma linha. O arquivo precisa ser CSV com uma linha de cabeçalho.');
          return;
        }
        setColunas(campos);
        setLinhas(res.data);
        const palpite = sugerirMapa(campos);
        setMapa({
          telefone: palpite.telefone ?? '',
          nome: 'nome' in palpite ? palpite.nome : null,
          municipio: 'municipio' in palpite ? palpite.municipio : null,
        });
        setEtapa('mapear');
      },
      error: () => setErro('Não consegui abrir o arquivo.'),
    });
  }

  function conferir() {
    if (!mapa.telefone) {
      setErro('Escolha qual coluna tem o telefone.');
      return;
    }
    setErro(null);
    const a = analisarLinhas(linhas, mapa);
    setAnalise(a);

    iniciar(async () => {
      try {
        let jaExistem = 0;
        let bloqueados = 0;
        for (const bloco of emBlocos(a.validas.map((l) => l.chaveDedup), BLOCO)) {
          const r = await conferirBloco(bloco);
          jaExistem += r.jaExistem;
          bloqueados += r.bloqueados;
        }
        setConferencia({ jaExistem, bloqueados });
        setEtapa('conferir');
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao conferir.');
      }
    });
  }

  function importar() {
    if (!analise) return;
    setErro(null);
    setEtapa('importando');
    setProgresso(0);

    iniciar(async () => {
      try {
        const lista = await criarLista({
          origem,
          rotulo,
          entreguePor: origem === 'lista_fria' ? entreguePor : null,
          entregueEm: origem === 'lista_fria' ? entregueEm : null,
          arquivoNome: arquivo?.name ?? null,
          totalLinhas: analise.totalLinhas,
        });
        if (!lista.ok) {
          setErro(lista.erro);
          setEtapa('conferir');
          return;
        }

        const blocos = emBlocos(analise.validas, BLOCO);
        const soma: Totais = { importados: 0, duplicados: 0, bloqueados: 0 };

        for (let i = 0; i < blocos.length; i++) {
          const r = await importarBloco(lista.id, origem, blocos[i]);
          soma.importados += r.importados;
          soma.duplicados += r.duplicados;
          soma.bloqueados += r.bloqueados;
          setProgresso(Math.round(((i + 1) / blocos.length) * 100));
        }

        await finalizarLista(lista.id, { ...soma, invalidos: analise.invalidas });
        setTotais(soma);
        setEtapa('pronto');
      } catch (e) {
        setErro(e instanceof Error ? e.message : 'Falha ao importar.');
        setEtapa('conferir');
      }
    });
  }

  // ── Telas ──────────────────────────────────────────────────────────────────

  if (etapa === 'pronto' && totais) {
    return (
      <Cartao className="p-6">
        <h2 className="text-lg font-semibold">Importação concluída</h2>
        <Numeros
          itens={[
            ['Entraram na fila', totais.importados, 'text-ok'],
            ['Já estavam na base', totais.duplicados, ''],
            ['Bloqueados (pediram saída)', totais.bloqueados, 'text-alerta'],
            ['Números inválidos', analise?.invalidas ?? 0, 'text-suave'],
          ]}
        />
        <Botao className="mt-6" onClick={() => window.location.reload()}>
          Importar outra lista
        </Botao>
      </Cartao>
    );
  }

  if (etapa === 'importando') {
    return (
      <Cartao className="p-8 text-center">
        <p className="text-lg font-medium">Importando…</p>
        <div className="mx-auto mt-4 h-2 w-full max-w-md overflow-hidden rounded-full bg-fundo">
          <div className="h-full bg-acento transition-all" style={{ width: `${progresso}%` }} />
        </div>
        <p className="mt-2 text-sm text-suave">{progresso}%</p>
        <p className="mt-4 text-xs text-suave">Não feche a aba até terminar.</p>
      </Cartao>
    );
  }

  return (
    <div className="space-y-5">
      {erro && <Aviso tom="erro">{erro}</Aviso>}

      {/* 1. Arquivo */}
      <Cartao className="p-6">
        <h2 className="mb-1 font-semibold">1. O arquivo</h2>
        <p className="mb-4 text-sm text-suave">
          CSV com uma linha de cabeçalho. No Excel ou no Google Planilhas:
          <strong> Arquivo → Baixar → CSV</strong>.
        </p>
        <input
          type="file"
          accept=".csv,text/csv,text/plain"
          onChange={(e) => e.target.files?.[0] && lerArquivo(e.target.files[0])}
          className="block w-full text-sm file:mr-4 file:rounded-lg file:border-0 file:bg-acento file:px-4 file:py-2.5 file:text-sm file:font-medium file:text-white"
        />
        {arquivo && (
          <p className="mt-3 text-sm text-suave">
            {arquivo.name} · {linhas.length.toLocaleString('pt-BR')} linhas
          </p>
        )}
      </Cartao>

      {/* 2. Colunas e origem */}
      {etapa !== 'arquivo' && (
        <Cartao className="space-y-5 p-6">
          <div>
            <h2 className="mb-1 font-semibold">2. As colunas</h2>
            <p className="mb-4 text-sm text-suave">Confira o que o sistema achou.</p>
            <div className="grid gap-4 sm:grid-cols-3">
              <Seletor rotulo="Telefone (obrigatório)" valor={mapa.telefone} colunas={colunas}
                       aoMudar={(v) => setMapa({ ...mapa, telefone: v ?? '' })} obrigatorio />
              <Seletor rotulo="Nome" valor={mapa.nome} colunas={colunas}
                       aoMudar={(v) => setMapa({ ...mapa, nome: v })} />
              <Seletor rotulo="Cidade" valor={mapa.municipio} colunas={colunas}
                       aoMudar={(v) => setMapa({ ...mapa, municipio: v })} />
            </div>
          </div>

          <div className="border-t border-borda pt-5">
            <h2 className="mb-1 font-semibold">3. De onde veio</h2>
            <p className="mb-4 text-sm text-suave">
              Quente e fria nunca se misturam na fila: a quente é sempre atendida primeiro.
            </p>
            <div className="grid gap-3 sm:grid-cols-3">
              {([
                ['site', 'Cadastro no site', 'A pessoa se cadastrou — fila quente'],
                ['kit', 'Pedido de kit', 'A pessoa pediu material — fila quente'],
                ['lista_fria', 'Lista fria', 'Não conhece a campanha — fila fria'],
              ] as const).map(([valor, titulo, dica]) => (
                <label key={valor}
                  className={`cursor-pointer rounded-lg border p-3 ${origem === valor ? 'border-acento bg-acento/5' : 'border-borda'}`}>
                  <input type="radio" name="origem" checked={origem === valor}
                         onChange={() => setOrigem(valor)} className="sr-only" />
                  <span className="block text-sm font-medium">{titulo}</span>
                  <span className="block text-xs text-suave">{dica}</span>
                </label>
              ))}
            </div>

            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              <Campo rotulo="Nome desta lista" value={rotulo} onChange={(e) => setRotulo(e.target.value)}
                     placeholder="ex.: base Porto Velho agosto" />
            </div>

            {origem === 'lista_fria' && (
              <div className="mt-4 rounded-lg border border-alerta/30 bg-alerta/5 p-4">
                <p className="mb-3 text-sm font-medium text-alerta">
                  Lista fria não entra sem procedência.
                </p>
                <p className="mb-4 text-xs text-suave">
                  Quem entregou e quando. Sem isso não há rastreabilidade, e sem rastreabilidade
                  não há defesa se houver denúncia. O banco recusa a importação se ficar em branco.
                </p>
                <div className="grid gap-4 sm:grid-cols-2">
                  <Campo rotulo="Quem entregou" value={entreguePor}
                         onChange={(e) => setEntreguePor(e.target.value)}
                         placeholder="nome de quem forneceu" />
                  <Campo rotulo="Quando" type="date" value={entregueEm}
                         onChange={(e) => setEntregueEm(e.target.value)} />
                </div>
              </div>
            )}
          </div>

          <Botao tamanho="g" className="w-full" onClick={conferir}
                 disabled={ocupado || !mapa.telefone || !rotulo.trim()
                           || (origem === 'lista_fria' && !entreguePor.trim())}>
            {ocupado ? 'Conferindo…' : 'Conferir antes de importar'}
          </Botao>
        </Cartao>
      )}

      {/* 4. Conferência */}
      {etapa === 'conferir' && analise && conferencia && (
        <Cartao className="p-6">
          <h2 className="mb-1 font-semibold">4. Confira antes de confirmar</h2>
          <p className="mb-4 text-sm text-suave">Nada foi gravado ainda.</p>

          <Numeros
            itens={[
              ['Linhas no arquivo', analise.totalLinhas, ''],
              ['Vão entrar na fila',
               analise.validas.length - conferencia.jaExistem - conferencia.bloqueados, 'text-ok'],
              ['Repetidas', analise.duplicadasNoArquivo + conferencia.jaExistem, ''],
              ['Bloqueadas', conferencia.bloqueados, 'text-alerta'],
              ['Inválidas', analise.invalidas, 'text-suave'],
            ]}
          />

          {analise.invalidas > 0 && (
            <div className="mt-5 rounded-lg border border-borda bg-fundo p-4">
              <p className="mb-2 text-sm font-medium">Por que foram rejeitadas</p>
              <ul className="space-y-1 text-xs text-suave">
                {Object.entries(analise.porMotivo).map(([motivo, n]) => (
                  <li key={motivo}>
                    {n?.toLocaleString('pt-BR')} — {MOTIVO_LEGIVEL[motivo] ?? motivo}
                  </li>
                ))}
              </ul>
              {analise.exemplosRejeitados.length > 0 && (
                <details className="mt-3">
                  <summary className="cursor-pointer text-xs text-acento">ver exemplos</summary>
                  <ul className="mt-2 space-y-1 font-mono text-xs text-suave">
                    {analise.exemplosRejeitados.map((e) => (
                      <li key={e.linha}>linha {e.linha}: {e.valor} → {MOTIVO_LEGIVEL[e.motivo] ?? e.motivo}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )}

          <div className="mt-6 flex flex-wrap gap-3">
            <Botao tamanho="g" onClick={importar} disabled={ocupado}>
              Confirmar e importar
            </Botao>
            <Botao tamanho="g" variante="neutro" onClick={() => setEtapa('mapear')} disabled={ocupado}>
              Voltar
            </Botao>
          </div>
        </Cartao>
      )}
    </div>
  );
}

function Seletor({
  rotulo, valor, colunas, aoMudar, obrigatorio,
}: {
  rotulo: string; valor: string | null; colunas: string[];
  aoMudar: (v: string | null) => void; obrigatorio?: boolean;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-sm font-medium">{rotulo}</span>
      <select
        value={valor ?? ''}
        onChange={(e) => aoMudar(e.target.value || null)}
        className="w-full rounded-lg border border-borda bg-superficie px-3 py-2.5 text-sm"
      >
        <option value="">{obrigatorio ? 'escolha…' : 'não tem'}</option>
        {colunas.map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
    </label>
  );
}

function Numeros({ itens }: { itens: [string, number, string][] }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
      {itens.map(([rotulo, valor, classe]) => (
        <div key={rotulo}>
          <p className={`text-2xl font-semibold tabular-nums ${classe}`}>
            {valor.toLocaleString('pt-BR')}
          </p>
          <p className="text-xs text-suave">{rotulo}</p>
        </div>
      ))}
    </div>
  );
}
