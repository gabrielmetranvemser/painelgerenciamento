'use client';

import { useMemo, useState, useTransition } from 'react';
import { Aviso, Botao, Cartao, cx } from '@/components/ui';
import { ehGrave, montarTexto, validarModelo, VARIAVEIS_CONHECIDAS } from '@/lib/mensagem';
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

/**
 * O que a campanha recomenda para cada etapa.
 *
 * "Recomenda", e não "exige": desde que as regras deixaram de trancar a tela,
 * este texto seria uma promessa falsa se continuasse dizendo "precisa". Quem
 * escreve tem de saber que pode escrever à sua maneira — e por que a
 * recomendação existe.
 */
const EXPLICACAO: Partial<Record<EtapaMsg, string>> = {
  permissao:
    'O texto recomendado não tem link nem emoji, declara a chapa com {{candidatos}}, usa {{origem}} para dizer como você chegou no contato — a frase muda conforme a pessoa ter vindo da lista ou do site — e oferece parar e apagar. Escreva do seu jeito: o que faltar aparece em vermelho aqui embaixo, com o motivo, e a decisão é sua. Rotaciona entre as variações para o mesmo número não repetir o texto.',
  material:
    'O recomendado traz {{link}} — é dele que sai a única métrica confiável do projeto — e diz de quem é a peça, com {{candidato}}, {{cargo}} e {{numero}}.',
};

type Props = {
  modelos: (Modelo & { variacoes: Variacao[] })[];
  exemplo: {
    candidato: string; cargo: string; numero: string;
    partido: string; cnpj: string;
    /** A chapa de verdade: é ela que alimenta {{candidatos}} na Permissão. */
    chapa: { nome: string; cargo: string; numero: string; partido: string | null }[];
    timezone: string;
  };
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
      candidato: exemplo.candidato || '(cadastre um candidato)',
      cargo: exemplo.cargo || '(sem cargo)',
      numero: exemplo.numero || '00000',
      partido: exemplo.partido,
      cnpj: exemplo.cnpj || '00.000.000/0001-00',
      chapa: exemplo.chapa,
      origemContato: 'lista_fria',
      materiais: [{ titulo: 'Santinho', url: 'https://seu-dominio.com.br/r/abc123' }],
      link: 'https://seu-dominio.com.br/r/abc123',
      linkGrupo: 'https://whatsapp.com/channel/xxx',
      municipio: 'Porto Velho',
      agora: new Date(),
      timezone: exemplo.timezone,
    });
    return {
      problemas,
      previa,
      // Só o que sairia quebrado impede. Risco e aviso aparecem e não travam.
      impedido: problemas.some((p) => p.nivel === 'impede'),
      temRisco: problemas.some((p) => p.nivel === 'risco'),
    };
  }, [etapa, texto, exemplo]);
}

/**
 * O que o editor tem a dizer sobre o texto.
 *
 * Vermelho é o que custa caro — a defesa jurídica da campanha ou a saúde do
 * número — e âmbar é orientação de ofício. Nenhum dos dois impede salvar; o
 * único que impede é texto que sairia quebrado, e esse diz isso com todas as
 * letras, para ninguém confundir "você decide" com "não dá".
 */
function Problemas({ lista }: { lista: ReturnType<typeof validarModelo> }) {
  if (lista.length === 0) return null;
  return (
    <ul className="mt-2 space-y-1">
      {lista.map((p, i) => (
        <li key={i} className={cx('text-xs', ehGrave(p) ? 'text-perigo' : 'text-alerta')}>
          {ehGrave(p) ? '✕' : '!'} {p.mensagem}
          {p.nivel === 'impede' && <strong> Isso impede salvar.</strong>}
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
  const { problemas, previa, impedido, temRisco } = useValidacao(etapa, texto, exemplo);
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

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Botao tamanho="p" disabled={!mudou || impedido || ocupado}
          onClick={() => iniciar(async () => {
            const r = await salvarVariacao(variacao.id, etapa, texto);
            if (r.ok) { setSalvo(true); } else { setErro(r.erro); }
          })}>
          {/* "Mesmo assim" é o único atrito que sobrou: nomeia a escolha sem
              tirá-la de quem responde pela campanha. */}
          {ocupado ? 'Salvando…' : temRisco && !impedido ? 'Salvar mesmo assim' : 'Salvar'}
        </Botao>
        {salvo && !mudou && <span className="text-xs text-ok">salvo ✓</span>}
        {mudou && impedido && <span className="text-xs text-perigo">corrija para poder salvar</span>}
        {mudou && !impedido && temRisco && (
          <span className="text-xs text-suave">os pontos em vermelho ficam por sua conta</span>
        )}
      </div>
    </Cartao>
  );
}

function NovaVariacao({ modeloId, etapa, exemplo }: { modeloId: string; etapa: EtapaMsg; exemplo: Props['exemplo'] }) {
  const [aberto, setAberto] = useState(false);
  const [texto, setTexto] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const { problemas, previa, impedido, temRisco } = useValidacao(etapa, texto, exemplo);

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
        <Botao tamanho="p" disabled={!texto.trim() || impedido || ocupado}
          onClick={() => iniciar(async () => {
            const r = await adicionarVariacao(modeloId, etapa, texto);
            if (r.ok) { setTexto(''); setAberto(false); } else { setErro(r.erro); }
          })}>
          {temRisco && !impedido ? 'Adicionar mesmo assim' : 'Adicionar'}
        </Botao>
        <Botao tamanho="p" variante="fantasma" onClick={() => { setAberto(false); setTexto(''); }}>
          Cancelar
        </Botao>
      </div>
    </Cartao>
  );
}
