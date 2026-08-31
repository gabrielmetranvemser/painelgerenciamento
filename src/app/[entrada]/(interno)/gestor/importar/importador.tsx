'use client';

import Papa from 'papaparse';
import { useEffect, useState, useTransition } from 'react';
import { Check, Download, Plus } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, cx } from '@/components/ui';
import {
  analisarLinhas, decodificarPlanilha, emBlocos, modeloCsv, sugerirMapa,
  type Analise, type MapaColunas,
} from '@/lib/importacao';
import type { OrigemContato, Usuario } from '@/lib/tipos-banco';
import { alternarAtendenteNaLista } from '../listas/acoes';
import {
  conferirBloco, conferirMunicipios, criarLista, finalizarLista, importarBloco,
  listasInacabadas,
} from './acoes';

const BLOCO = 500;

type Etapa = 'arquivo' | 'mapear' | 'conferir' | 'importando' | 'pronto';

type Conferencia = { jaExistem: number; bloqueados: number };
type Cidades = { semCasar: number; exemplos: string[] };
type Inacabada = { id: string; rotulo: string; total_importados: number; criado_em: string };
type Totais = { novos: number; atualizados: number; bloqueados: number; devolvidos: number };

const MOTIVO_LEGIVEL: Record<string, string> = {
  vazio: 'sem telefone',
  curto: 'dígitos de menos',
  longo: 'dígitos demais',
  ddd_invalido: 'DDD que não existe',
  fixo: 'telefone fixo (não tem WhatsApp)',
  formato: 'não parece celular brasileiro',
};

type Atendente = Pick<Usuario, 'id' | 'primeiro_nome'>;

export function Importador({ atendentes }: { atendentes: Atendente[] }) {
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
  const [cidades, setCidades] = useState<Cidades | null>(null);
  const [inacabadas, setInacabadas] = useState<Inacabada[]>([]);
  const [progresso, setProgresso] = useState(0);
  const [totais, setTotais] = useState<Totais | null>(null);
  /** A lista recém-criada, para o último passo escolher quem vai atendê-la. */
  const [listaId, setListaId] = useState<string | null>(null);

  // Importação que morreu no meio deixa contatos na fila e ninguém sabendo.
  // O aviso aparece na próxima vez que alguém abre esta tela.
  useEffect(() => {
    listasInacabadas().then(setInacabadas).catch(() => {});
  }, []);

  /**
   * Lê o arquivo à mão, em vez de entregar o `File` direto ao Papa.
   *
   * Quem decide encoding e formato é `decodificarPlanilha`, em src/lib — está
   * lá, e não aqui, porque são as duas armadilhas mais silenciosas da
   * importação (CSV do Excel em Windows-1252 e .xlsx disfarçado) e elas
   * precisam de teste, não de confiança.
   */
  async function lerArquivo(f: File) {
    setErro(null);
    setArquivo(f);
    setRotulo((r) => r || f.name.replace(/\.[^.]+$/, ''));

    let bytes: ArrayBuffer;
    try {
      bytes = await f.arrayBuffer();
    } catch {
      setErro('Não consegui abrir o arquivo.');
      return;
    }

    const leitura = decodificarPlanilha(bytes);
    if (!leitura.ok) {
      setErro(
        leitura.problema === 'planilha_binaria'
          ? 'Isto é uma planilha do Excel (.xlsx), não um CSV. No Excel: Arquivo → Salvar como → ' +
            '"CSV UTF-8 (delimitado por vírgulas)". No Google Planilhas: Arquivo → Fazer download ' +
            '→ Valores separados por vírgulas.'
          : 'O arquivo chegou vazio.',
      );
      return;
    }

    const res = Papa.parse<Record<string, string>>(leitura.texto, {
      header: true,
      skipEmptyLines: 'greedy',
      // O CSV que o Excel em português gera é separado por ponto e vírgula.
      delimitersToGuess: [';', ',', '\t', '|'],
    });

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

        // Rede de segurança do encoding: se a cidade não casa, o relatório por
        // município nasce vazio e ninguém percebe.
        const nomes = a.validas.map((l) => l.municipioNome).filter((n): n is string => !!n);
        setCidades(nomes.length > 0 ? await conferirMunicipios(nomes) : null);

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
          totalInvalidos: analise.invalidas,
        });
        if (!lista.ok) {
          setErro(lista.erro);
          setEtapa('conferir');
          return;
        }

        const blocos = emBlocos(analise.validas, BLOCO);
        const soma: Totais = { novos: 0, atualizados: 0, bloqueados: 0, devolvidos: 0 };

        for (let i = 0; i < blocos.length; i++) {
          const r = await importarBloco(lista.id, origem, blocos[i]);
          soma.novos += r.novos;
          soma.atualizados += r.atualizados;
          soma.bloqueados += r.bloqueados;
          soma.devolvidos += r.devolvidos;
          setProgresso(Math.round(((i + 1) / blocos.length) * 100));
        }

        await finalizarLista(lista.id);
        setListaId(lista.id);
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
            // "Entraram na base", e não "entraram na fila": a fila é de quem
            // tem a lista marcada, e isso é o passo seguinte desta tela.
            ['Entraram na base', totais.novos, 'text-ok'],
            ['Vieram para esta lista', totais.atualizados, 'text-ok'],
            ['Bloqueados (pediram saída)', totais.bloqueados, 'text-alerta'],
            ['Números inválidos', analise?.invalidas ?? 0, 'text-suave'],
          ]}
        />

        {/* ⚠️ Esta frase existe porque a versão anterior mentia por omissão:
            número repetido era descartado em silêncio, a lista nova nascia
            vazia, e o gestor desativava a antiga achando que tinha substituído.
            Agora o repetido MUDA de lista — e a tela conta o que foi feito com
            ele, inclusive quantos voltaram para a fila. */}
        {totais.atualizados > 0 && (
          <p className="mt-4 text-sm leading-relaxed text-suave">
            {totais.atualizados.toLocaleString('pt-BR')} pessoa(s) já estavam na base e
            passaram para esta lista, com nome e município atualizados. O histórico de
            atendimento delas foi mantido.
            {totais.devolvidos > 0
              ? ` Dessas, ${totais.devolvidos.toLocaleString('pt-BR')} ainda não tinham sido
                  abordadas e voltaram para a fila.`
              : ' Nenhuma voltou para a fila: todas já tinham sido abordadas, e o desfecho delas foi preservado.'}
          </p>
        )}

        {listaId && (
          <QuemAtende listaId={listaId} rotulo={rotulo} atendentes={atendentes} />
        )}

        <Botao className="mt-6" variante="neutro" onClick={() => window.location.reload()}>
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

      {inacabadas.length > 0 && (
        <Aviso tom="alerta">
          <p className="font-medium">
            {inacabadas.length === 1
              ? 'Uma importação não chegou ao fim.'
              : `${inacabadas.length} importações não chegaram ao fim.`}
          </p>
          <p className="mt-1 text-sm">
            A aba foi fechada no meio. O que já tinha entrado <strong>está na fila e vai ser
            atendido</strong> — o que falta é o resto do arquivo. Importe a mesma planilha de
            novo: quem já entrou é reconhecido e não duplica.
          </p>
          <ul className="mt-2 space-y-1 text-sm">
            {inacabadas.map((l) => (
              <li key={l.id}>
                <strong>{l.rotulo}</strong> · {l.total_importados.toLocaleString('pt-BR')} entraram ·{' '}
                {new Date(l.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
              </li>
            ))}
          </ul>
        </Aviso>
      )}

      {/* 1. Arquivo */}
      <Cartao className="p-6">
        <h2 className="mb-1 font-semibold">1. O arquivo</h2>
        <p className="mb-4 text-sm text-suave">
          CSV com uma linha de cabeçalho. No Excel: <strong>Arquivo → Salvar como → CSV UTF-8</strong>.
          No Google Planilhas: <strong>Arquivo → Fazer download → CSV</strong>. Arquivo
          <code className="mx-1 rounded bg-fundo px-1 py-0.5 text-xs">.xlsx</code> não serve — o
          sistema avisa se você escolher um.
        </p>

        <QueColunas />

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
              ['Pessoas novas',
               analise.validas.length - conferencia.jaExistem - conferencia.bloqueados, 'text-ok'],
              ['Já na base — vêm para esta lista', conferencia.jaExistem, 'text-ok'],
              ['Repetidas dentro do arquivo', analise.duplicadasNoArquivo, ''],
              ['Bloqueadas', conferencia.bloqueados, 'text-alerta'],
              ['Inválidas', analise.invalidas, 'text-suave'],
            ]}
          />

          {cidades && cidades.semCasar > 0 && (
            <div className="mt-5 rounded-lg border border-alerta/40 bg-alerta/5 p-4">
              <p className="mb-1 text-sm font-medium text-alerta">
                {cidades.semCasar.toLocaleString('pt-BR')} linha(s) com cidade que não existe na
                lista de Rondônia
              </p>
              <p className="text-xs leading-relaxed text-suave">
                Essas pessoas entram normalmente, mas caem em &ldquo;(não informado)&rdquo; no
                relatório por município — que é o que mostra onde a campanha está pegando. Se os
                exemplos abaixo estiverem com os acentos quebrados, o arquivo foi salvo no
                encoding errado: reexporte como <strong>CSV UTF-8</strong>.
              </p>
              <p className="mt-2 text-xs text-suave">
                Exemplos: {cidades.exemplos.map((e) => `“${e}”`).join(' · ')}
              </p>
            </div>
          )}

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

/**
 * O que a planilha precisa ter — e o modelo para baixar.
 *
 * ⚠️ Isto existe porque a pergunta chegava sempre na mesma ordem: "o que dá
 * para importar? nome? número? e-mail?". A tela pedia um CSV e não dizia de
 * quê, então o gestor montava a planilha adivinhando — e descobria o que
 * faltava só depois de subir o arquivo.
 *
 * O modelo baixado é gerado pela mesma função que os testes passam pelo caminho
 * real de importação. Um modelo que o próprio sistema recusaria seria pior que
 * modelo nenhum.
 */
function QueColunas() {
  function baixar() {
    const blob = new Blob([modeloCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'modelo-importacao.csv';
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="mb-4 rounded-2xl border border-borda bg-fundo p-4">
      <div className="mb-3 flex flex-wrap items-center gap-3">
        <p className="mr-auto text-sm font-semibold">O sistema usa três colunas</p>
        <Botao variante="neutro" tamanho="p" onClick={baixar}>
          <Download size={13} /> Baixar modelo
        </Botao>
      </div>

      <dl className="space-y-2.5 text-xs">
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="w-24 shrink-0 font-mono font-semibold text-texto">telefone</dt>
          <dd className="min-w-0 flex-1 text-suave">
            <span className="font-medium text-acento">obrigatória</span> · celular com DDD, em
            qualquer formato: <span className="text-texto">(69) 99999-0000</span>,{' '}
            <span className="text-texto">69999990000</span> ou{' '}
            <span className="text-texto">5569999990000</span>. Telefone fixo é recusado — não tem
            WhatsApp.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="w-24 shrink-0 font-mono font-semibold text-texto">nome</dt>
          <dd className="min-w-0 flex-1 text-suave">
            opcional · só o primeiro nome entra na mensagem. Sem ele, a mensagem sai sem nome em
            vez de sair quebrada.
          </dd>
        </div>
        <div className="flex flex-wrap gap-x-2 gap-y-0.5">
          <dt className="w-24 shrink-0 font-mono font-semibold text-texto">municipio</dt>
          <dd className="min-w-0 flex-1 text-suave">
            opcional · um dos 52 de Rondônia. É o que faz o relatório por cidade existir; o que não
            casar é avisado antes de gravar.
          </dd>
        </div>
      </dl>

      <p className="mt-3 border-t border-borda pt-3 text-xs leading-relaxed text-suave">
        <strong className="text-texto">Não existe e-mail, endereço nem observação.</strong> Não é
        limitação desta tela — não existe campo para isso em lugar nenhum do sistema, porque o
        atendimento é por WhatsApp e dado que ninguém vai usar é dado guardado à toa.{' '}
        <strong className="text-texto">A ordem das colunas não importa</strong> e qualquer coluna a
        mais é ignorada sem erro: pode subir a planilha como ela veio.
      </p>
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

/**
 * O último passo da importação: quem atende esta lista.
 *
 * Está AQUI, e não só na tela de Listas, porque é aqui que o gestor está
 * pensando no assunto. A planilha entra na base sem dono, e lista sem dono não
 * vai para fila nenhuma — os contatos ficam guardados, sem serem chamados. Sem
 * este passo, o defeito só aparece dias depois, quando um atendente diz que a
 * fila dele está vazia com a base cheia.
 *
 * Estado local, e não `router.refresh()`: atualizar a página do servidor aqui
 * jogaria a tela de volta para o passo 1 e o gestor perderia o resumo da
 * importação que acabou de acontecer.
 */
function QuemAtende({
  listaId, rotulo, atendentes,
}: {
  listaId: string;
  rotulo: string;
  atendentes: Atendente[];
}) {
  const [marcados, setMarcados] = useState<string[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  if (atendentes.length === 0) {
    return (
      <Aviso tom="alerta" className="mt-6">
        Não há atendente ativo cadastrado, então esta lista ainda não vai para fila nenhuma.
        Crie as contas em Equipe → Atendentes e volte para marcar quem atende.
      </Aviso>
    );
  }

  return (
    <div className="mt-6 rounded-2xl border border-borda bg-fundo p-4">
      <p className="text-sm font-semibold">Quem vai atender “{rotulo}”?</p>
      <p className="mt-1 text-xs leading-relaxed text-suave">
        Enquanto ninguém estiver marcado, estes contatos ficam guardados sem entrar na fila de
        ninguém. Marcar duas pessoas divide a lista entre elas — sem risco de as duas falarem com
        a mesma pessoa. Dá para mudar depois em Base → Listas.
      </p>

      <ul className="mt-3 flex flex-wrap gap-2">
        {atendentes.map((a) => {
          const marcado = marcados.includes(a.id);
          return (
            <li key={a.id}>
              <button
                type="button"
                disabled={ocupado}
                aria-pressed={marcado}
                onClick={() => iniciar(async () => {
                  const r = await alternarAtendenteNaLista(listaId, a.id, !marcado);
                  if (!r.ok) { setErro(r.erro); return; }
                  setErro(null);
                  setMarcados((m) => (marcado ? m.filter((x) => x !== a.id) : [...m, a.id]));
                })}
                className={cx(
                  'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
                  marcado
                    ? 'border-acento/40 bg-acento/12 text-acento'
                    : 'border-borda bg-superficie text-suave hover:border-borda-forte hover:text-texto',
                )}
              >
                {marcado ? <Check size={12} /> : <Plus size={12} />}
                {a.primeiro_nome}
              </button>
            </li>
          );
        })}
      </ul>

      {erro && <Aviso tom="erro" className="mt-3">{erro}</Aviso>}
    </div>
  );
}
