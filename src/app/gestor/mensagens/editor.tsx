'use client';

import { useMemo, useState, useTransition } from 'react';
import { Aviso, Botao, Cartao } from '@/components/ui';
import { montarTexto, validarModelo, VARIAVEIS_CONHECIDAS } from '@/lib/mensagem';
import type { EtapaMsg, Modelo, Variacao } from '@/lib/tipos-banco';
import { adicionarVariacao, alternarVariacao, salvarVariacao } from './acoes';

const TITULO: Record<EtapaMsg, string> = {
  permissao: 'Permissão — a primeira mensagem',
  material: 'Material — depois do "pode"',
  saida: 'Saída — quando a pessoa pede para sair',
  quem_passou: 'Quem passou meu número',
  quer_ajudar: 'Quer ajudar',
  encaminhamento: 'Encaminhamento',
  convite_grupo: 'Convite ao canal',
};

const EXPLICACAO: Partial<Record<EtapaMsg, string>> = {
  permissao:
    'Sem link e sem emoji. Precisa dizer quem é o candidato e para qual cargo na mesma frase, explicar que um apoiador passou o contato, e oferecer parar e apagar. Rotaciona entre as variações para o mesmo número não repetir o texto.',
  material:
    'Precisa conter {{link}} — é dele que sai a única métrica confiável do projeto.',
};

type Props = {
  modelos: (Modelo & { variacoes: Variacao[] })[];
  exemplo: { candidato: string; cargo: string; numero: string; timezone: string };
};

export function EditorMensagens({ modelos, exemplo }: Props) {
  return (
    <div className="space-y-6">
      {modelos.map((m) => (
        <section key={m.id}>
          <h2 className="font-semibold">{TITULO[m.etapa]}</h2>
          {EXPLICACAO[m.etapa] && (
            <p className="mb-3 mt-0.5 text-xs text-suave">{EXPLICACAO[m.etapa]}</p>
          )}
          <div className="space-y-3">
            {m.variacoes.map((v, i) => (
              <EditorVariacao key={v.id} variacao={v} etapa={m.etapa} indice={i + 1}
                              podeDesativar={m.variacoes.filter((x) => x.ativa).length > 1}
                              exemplo={exemplo} />
            ))}
            <NovaVariacao modeloId={m.id} etapa={m.etapa} exemplo={exemplo} />
          </div>
        </section>
      ))}
    </div>
  );
}

function useValidacao(etapa: EtapaMsg, texto: string, exemplo: Props['exemplo']) {
  return useMemo(() => {
    const problemas = validarModelo(etapa, texto);
    const previa = montarTexto(texto, {
      primeiroNome: 'Maria',
      nomeAtendente: 'Lucas',
      candidato: exemplo.candidato || '(defina o candidato em Configuração)',
      cargo: exemplo.cargo || '(defina o cargo)',
      numero: exemplo.numero || '00000',
      link: 'https://seu-dominio.com.br/r/abc123',
      linkGrupo: 'https://whatsapp.com/channel/xxx',
      municipio: 'Porto Velho',
      agora: new Date(),
      timezone: exemplo.timezone,
    });
    return { problemas, previa, bloqueado: problemas.some((p) => p.bloqueia) };
  }, [etapa, texto, exemplo]);
}

function Problemas({ lista }: { lista: ReturnType<typeof validarModelo> }) {
  if (lista.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {lista.map((p, i) => (
        <li key={i} className={`text-xs ${p.bloqueia ? 'text-perigo' : 'text-alerta'}`}>
          {p.bloqueia ? '✕' : '!'} {p.mensagem}
        </li>
      ))}
    </ul>
  );
}

function Previa({ texto }: { texto: string }) {
  return (
    <div className="mt-2">
      <p className="mb-1 text-xs font-medium text-suave">Como a pessoa vê</p>
      <p className="whitespace-pre-wrap rounded-lg bg-fundo p-3 text-sm">{texto}</p>
    </div>
  );
}

function EditorVariacao({
  variacao, etapa, indice, podeDesativar, exemplo,
}: {
  variacao: Variacao; etapa: EtapaMsg; indice: number; podeDesativar: boolean; exemplo: Props['exemplo'];
}) {
  const [texto, setTexto] = useState(variacao.texto);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const { problemas, previa, bloqueado } = useValidacao(etapa, texto, exemplo);
  const mudou = texto !== variacao.texto;

  return (
    <Cartao className={`p-4 ${!variacao.ativa ? 'opacity-60' : ''}`}>
      <div className="mb-2 flex items-center gap-3">
        <span className="text-xs font-medium text-suave">Variação {indice}</span>
        {!variacao.ativa && <span className="text-xs text-suave">(desativada)</span>}
        <button
          type="button"
          className="ml-auto text-xs text-suave hover:text-texto"
          disabled={ocupado || (variacao.ativa && !podeDesativar)}
          onClick={() => iniciar(async () => {
            const r = await alternarVariacao(variacao.id, !variacao.ativa);
            if (!r.ok) setErro(r.erro);
          })}
        >
          {variacao.ativa ? 'desativar' : 'reativar'}
        </button>
      </div>

      <textarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setSalvo(false); setErro(null); }}
        rows={4}
        className="w-full resize-y rounded-lg border border-borda bg-superficie p-3 text-sm"
      />

      <Problemas lista={problemas} />
      <Previa texto={previa} />

      {erro && <Aviso tom="erro" className="mt-2">{erro}</Aviso>}

      <div className="mt-3 flex items-center gap-3">
        <Botao tamanho="p" disabled={!mudou || bloqueado || ocupado}
          onClick={() => iniciar(async () => {
            const r = await salvarVariacao(variacao.id, etapa, texto);
            if (r.ok) { setSalvo(true); } else { setErro(r.erro); }
          })}>
          {ocupado ? 'Salvando…' : 'Salvar'}
        </Botao>
        {salvo && !mudou && <span className="text-xs text-ok">salvo ✓</span>}
        {mudou && bloqueado && <span className="text-xs text-perigo">corrija para poder salvar</span>}
      </div>
    </Cartao>
  );
}

function NovaVariacao({ modeloId, etapa, exemplo }: { modeloId: string; etapa: EtapaMsg; exemplo: Props['exemplo'] }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const { problemas, previa, bloqueado } = useValidacao(etapa, texto, exemplo);

  if (!aberto) {
    return (
      <button type="button" onClick={() => setAberto(true)}
              className="w-full rounded-xl border border-dashed border-borda py-3 text-sm text-suave hover:text-texto">
        + nova variação
      </button>
    );
  }

  return (
    <Cartao className="p-4">
      <textarea
        value={texto}
        onChange={(e) => { setTexto(e.target.value); setErro(null); }}
        rows={4}
        autoFocus
        placeholder="Escreva o texto usando as variáveis…"
        className="w-full resize-y rounded-lg border border-borda bg-superficie p-3 text-sm"
      />
      <p className="mt-1.5 text-xs text-suave">
        Variáveis: {VARIAVEIS_CONHECIDAS.map((v) => `{{${v}}}`).join(' · ')}
      </p>
      {texto.trim() && (<><Problemas lista={problemas} /><Previa texto={previa} /></>)}
      {erro && <Aviso tom="erro" className="mt-2">{erro}</Aviso>}
      <div className="mt-3 flex gap-2">
        <Botao tamanho="p" disabled={!texto.trim() || bloqueado || ocupado}
          onClick={() => iniciar(async () => {
            const r = await adicionarVariacao(modeloId, etapa, texto);
            if (r.ok) { setTexto(''); setAberto(false); } else { setErro(r.erro); }
          })}>
          Adicionar
        </Botao>
        <Botao tamanho="p" variante="fantasma" onClick={() => { setAberto(false); setTexto(''); }}>
          Cancelar
        </Botao>
      </div>
    </Cartao>
  );
}
