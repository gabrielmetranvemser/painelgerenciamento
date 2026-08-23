'use client';

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from 'react';
import { Aviso, Botao, Cartao, EtiquetaOrigem } from '@/components/ui';
import { ComoAgir } from '@/components/como-agir';
import { formatarExibicao } from '@/lib/telefone';
import { RESULTADOS, TEXTO_MOTIVO, type Chip, type ContatoDaFila, type EtapaMsg, type FilaStatus, type Municipio, type Resultado } from '@/lib/tipos-banco';
import {
  consultarFila, definirMunicipio, pegarProximo, prepararMensagem,
  registrarAbertura, registrarResultado, sinalizarChip, type MensagemPronta,
} from './acoes';

type Fase = 'ocioso' | 'permissao' | 'aberta' | 'seguimento';

/**
 * A mensagem que cada resultado carrega (docs/03-OPERACAO.md §4).
 * "Número inválido" é o único sem seguimento: vai direto para o próximo.
 */
const SEGUIMENTO: Partial<Record<Resultado, EtapaMsg>> = {
  autorizou: 'material',
  pediu_saida: 'saida',
  quer_ajudar: 'quer_ajudar',
  encaminhado: 'encaminhamento',
};

const TITULO_ETAPA: Partial<Record<EtapaMsg, string>> = {
  permissao: 'Primeira mensagem — só o pedido de permissão',
  material: 'Segunda mensagem — o material',
  saida: 'Confirme que o contato saiu da lista',
  quer_ajudar: 'Resposta para quem quer ajudar',
  encaminhamento: 'Resposta para quem pediu algo que não podemos prometer',
};

const ROTULO_RESULTADO: Record<Resultado, string> = {
  autorizou: 'Autorizou',
  pediu_saida: 'Pediu saída',
  invalido: 'Número inválido',
  quer_ajudar: 'Quer ajudar',
  encaminhado: 'Encaminhar',
};

/** Nome da janela do WhatsApp: reaproveita a mesma aba em vez de abrir 30. */
const JANELA_WA = 'whatsapp-atendimento';

const CHAVE_CHIP = 'chip';

/**
 * Lê o chip salvo sem causar remontagem nem divergência de hidratação.
 *
 * useSyncExternalStore é o jeito que o React prevê para ler de um armazenamento
 * externo: no servidor devolve null, no cliente devolve o valor guardado, e o
 * próprio React concilia a diferença. Ler em useEffect e chamar setState
 * causaria uma renderização em cascata a cada montagem — numa tela que o
 * atendente abre e recarrega o dia inteiro.
 */
function assinarArmazenamento(aoMudar: () => void) {
  window.addEventListener('storage', aoMudar);
  return () => window.removeEventListener('storage', aoMudar);
}

function useChipSalvo(): string | null {
  return useSyncExternalStore(
    assinarArmazenamento,
    () => window.localStorage.getItem(CHAVE_CHIP),
    () => null,
  );
}

export function Atendimento({
  primeiroNome,
  chips,
  municipios,
  filaInicial,
}: {
  primeiroNome: string;
  chips: Chip[];
  municipios: Municipio[];
  filaInicial: FilaStatus | null;
}) {
  // `null` enquanto o atendente não escolheu explicitamente nesta sessão.
  const [chipEscolhido, setChipEscolhido] = useState<string | null>(null);
  const chipSalvo = useChipSalvo();
  const [fila, setFila] = useState<FilaStatus | null>(filaInicial);
  const [contato, setContato] = useState<ContatoDaFila | null>(null);
  const [mensagem, setMensagem] = useState<MensagemPronta | null>(null);
  const [fase, setFase] = useState<Fase>('ocioso');
  const [espera, setEspera] = useState(filaInicial?.segundos_espera ?? 0);
  const [municipioId, setMunicipioId] = useState<number | ''>('');
  const [encaminhamento, setEncaminhamento] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const botaoAbrir = useRef<HTMLButtonElement>(null);

  const vivos = chips.filter((c) => c.status !== 'morto');
  const valido = (id: string | null) => (id && vivos.some((c) => c.id === id) ? id : null);
  const chipId = valido(chipEscolhido) ?? valido(chipSalvo) ?? vivos[0]?.id ?? '';
  const chip = vivos.find((c) => c.id === chipId);

  // O número que o atendente usava caiu. Ele precisa saber ANTES de tentar
  // trabalhar — e precisa saber o que fazer (docs/03-OPERACAO.md §2.5).
  const morto = chipSalvo ? chips.find((c) => c.id === chipSalvo && c.status === 'morto') : undefined;
  const reserva = vivos.find((c) => c.papel === 'reserva') ?? vivos[0];

  // Lembra o número escolhido: o atendente troca de perfil do Chrome, não de aba.
  function trocarChip(id: string) {
    setChipEscolhido(id);
    window.localStorage.setItem(CHAVE_CHIP, id);
  }

  const atualizarFila = useCallback(async () => {
    if (!chipId) return;
    const f = await consultarFila(chipId);
    setFila(f);
    setEspera(f.segundos_espera);
  }, [chipId]);

  // Contagem regressiva do intervalo entre conversas.
  useEffect(() => {
    if (espera <= 0) return;
    const t = setInterval(() => setEspera((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(t);
  }, [espera]);

  // Quando o intervalo termina, confirma com o SERVIDOR — o relógio do navegador
  // não decide nada, só mostra. O agendamento sai do tempo que o servidor
  // informou, não da contagem local, para não depender de o usuário ter deixado
  // a aba em primeiro plano.
  useEffect(() => {
    if (fila?.motivo !== 'intervalo' || fila.segundos_espera <= 0) return;
    const t = setTimeout(() => void atualizarFila(), fila.segundos_espera * 1000 + 300);
    return () => clearTimeout(t);
  }, [fila, atualizarFila]);

  // Enquanto ocioso, reconsulta de tempos em tempos: a fila pode receber
  // contatos novos e o horário pode virar.
  useEffect(() => {
    if (fase !== 'ocioso') return;
    const t = setInterval(() => void atualizarFila(), 15000);
    return () => clearInterval(t);
  }, [fase, atualizarFila]);

  function buscarProximo() {
    setErro(null);
    iniciar(async () => {
      const r = await pegarProximo(chipId);
      setFila(r.fila);
      setEspera(r.fila.segundos_espera);
      if (!r.ok) {
        setContato(null);
        setMensagem(null);
        setFase('ocioso');
        return;
      }
      setContato(r.contato);
      setMunicipioId(r.contato.municipio_id ?? '');
      setEncaminhamento('');

      const m = await prepararMensagem(r.contato.id, chipId, 'permissao');
      if (!m.ok) {
        setErro(`Não consegui montar a mensagem (${m.motivo}). Fale com o gestor.`);
        return;
      }
      setMensagem(m);
      setFase('permissao');
      setTimeout(() => botaoAbrir.current?.focus(), 50);
    });
  }

  function abrirConversa() {
    if (!contato || !mensagem) return;
    // window.open precisa ser síncrono no clique, senão o navegador bloqueia.
    window.open(mensagem.urlWhatsApp, JANELA_WA);
    setErro(null);
    iniciar(async () => {
      const r = await registrarAbertura(contato.id, chipId, mensagem.etapa, mensagem.texto, mensagem.variacaoId);
      if (!r.ok) {
        setErro(`O sistema não registrou o envio: ${r.motivo}. Não continue — fale com o gestor.`);
        return;
      }
      setFila(r.fila);
      setEspera(r.fila.segundos_espera);
      if (mensagem.etapa === 'permissao') setFase('aberta');
    });
  }

  function marcar(resultado: Resultado) {
    if (!contato || fase !== 'aberta') return;
    if (resultado === 'encaminhado' && !encaminhamento.trim()) {
      setErro('Escreva em uma linha o que a pessoa pediu, para a equipe saber o que encaminhar.');
      return;
    }
    setErro(null);
    iniciar(async () => {
      const r = await registrarResultado(contato.id, resultado, null, encaminhamento);
      if (!r.ok) {
        setErro(`Não consegui gravar o resultado: ${r.motivo}`);
        return;
      }
      // Cada resultado carrega a mensagem seguinte. Sem isto, quem pediu saída
      // ficava sem a confirmação, e quem quis ajudar ficava sem resposta.
      const etapa = SEGUIMENTO[resultado];
      if (etapa) {
        const m = await prepararMensagem(contato.id, chipId, etapa);
        if (m.ok) {
          setMensagem(m);
          setFase('seguimento');
          setTimeout(() => botaoAbrir.current?.focus(), 50);
          return;
        }
      }
      limparEBuscar();
    });
  }

  function limparEBuscar() {
    setContato(null);
    setMensagem(null);
    setFase('ocioso');
    buscarProximo();
  }

  // Atalhos de teclado: são 30 conversas por dia, o mouse cansa.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;

      if (fase === 'aberta') {
        const i = Number(e.key) - 1;
        if (i >= 0 && i < RESULTADOS.length) {
          e.preventDefault();
          marcar(RESULTADOS[i]);
        }
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  });

  if (vivos.length === 0) {
    return (
      <Aviso tom="alerta">
        {chips.length === 0
          ? 'Você ainda não tem nenhum número cadastrado. Peça ao gestor para cadastrar o seu Chip A.'
          : 'Todos os seus números foram desativados. Fale com o gestor antes de continuar.'}
      </Aviso>
    );
  }

  const travado = fila && !fila.pode && fase === 'ocioso';

  return (
    <div className="grid gap-5 lg:grid-cols-[1fr_320px]">
      <div className="space-y-5">
        <Barra
          primeiroNome={primeiroNome}
          fila={fila}
          chips={vivos}
          chipId={chipId}
          aoTrocarChip={trocarChip}
          aoSinalizar={() => iniciar(async () => { await sinalizarChip(chipId); await atualizarFila(); })}
        />

        {erro && <Aviso tom="erro">{erro}</Aviso>}

        {morto && (
          <Aviso tom="erro">
            <strong>Seu {morto.rotulo} foi desativado.</strong>{' '}
            {reserva
              ? `Feche esta janela e abra o atalho do ${reserva.rotulo}. As conversas que estavam no ${morto.rotulo} não voltam — quem respondeu por lá não chega mais até você.`
              : 'Fale com o gestor: você não tem outro número disponível.'}
          </Aviso>
        )}

        {chip && chip.status === 'amarelo' && (
          <Aviso tom="alerta">
            Seu número está marcado como <strong>atenção</strong>. Vá mais devagar e avise o gestor.
          </Aviso>
        )}

        {travado && (
          <Cartao className="p-8 text-center">
            <p className="text-lg font-medium">{TEXTO_MOTIVO[fila.motivo]}</p>
            {fila.motivo === 'intervalo' && (
              <>
                <p className="mt-4 font-mono text-5xl tabular-nums">{espera}s</p>
                <p className="mt-2 text-sm text-suave">
                  O intervalo existe para o WhatsApp não ler seu número como disparo.
                </p>
              </>
            )}
            {fila.motivo === 'fora_de_horario' && (
              <p className="mt-2 text-sm text-suave">
                O atendimento vai das {fila.hora_inicio}h às {fila.hora_fim}h. Agora são {fila.hora_local}h.
              </p>
            )}
            {fila.motivo === 'teto_atingido' && (
              <p className="mt-2 text-sm text-suave">
                Foram {fila.enviados_hoje} conversas hoje. Amanhã tem mais.
              </p>
            )}
          </Cartao>
        )}

        {!travado && fase === 'ocioso' && (
          <Cartao className="p-8 text-center">
            <p className="mb-1 text-lg font-medium">Pronto para começar</p>
            <p className="mb-6 text-sm text-suave">
              {fila?.quentes_na_fila
                ? `Comece pelos ${fila.quentes_na_fila} cadastros novos — são pessoas que pediram contato.`
                : `${fila?.frios_na_fila ?? 0} contatos na fila.`}
            </p>
            <Botao tamanho="g" onClick={buscarProximo} disabled={ocupado}>
              {ocupado ? 'Buscando…' : 'Buscar próximo contato'}
            </Botao>
          </Cartao>
        )}

        {contato && mensagem && fase !== 'ocioso' && (
          <CartaoAtendimento
            contato={contato}
            mensagem={mensagem}
            fase={fase}
            ocupado={ocupado}
            refBotao={botaoAbrir}
            municipios={municipios}
            municipioId={municipioId}
            encaminhamento={encaminhamento}
            aoMudarMunicipio={(id) => {
              setMunicipioId(id);
              if (id) iniciar(async () => { await definirMunicipio(contato.id, id); });
            }}
            aoMudarEncaminhamento={setEncaminhamento}
            aoAbrir={abrirConversa}
            aoMarcar={marcar}
            aoProximo={limparEBuscar}
          />
        )}
      </div>

      <aside className="space-y-5">
        <Regras teto={fila?.teto_hoje ?? 30} inicio={fila?.hora_inicio ?? 9} fim={fila?.hora_fim ?? 20} />
        <ComoAgir />
      </aside>
    </div>
  );
}

// ── Barra de contadores ──────────────────────────────────────────────────────

function Barra({
  primeiroNome, fila, chips, chipId, aoTrocarChip, aoSinalizar,
}: {
  primeiroNome: string;
  fila: FilaStatus | null;
  chips: Chip[];
  chipId: string;
  aoTrocarChip: (id: string) => void;
  aoSinalizar: () => void;
}) {
  return (
    <Cartao className="flex flex-wrap items-center gap-x-6 gap-y-3 px-5 py-4">
      <div className="mr-auto">
        <p className="font-medium">Olá, {primeiroNome}</p>
        <p className="text-xs text-suave">
          {fila ? `${fila.restante_hoje} de ${fila.teto_hoje} conversas restantes hoje` : '—'}
        </p>
      </div>

      <div className="flex items-center gap-4 text-center">
        <Contador rotulo="Quentes" valor={fila?.quentes_na_fila ?? 0} classe="text-quente" />
        <Contador rotulo="Frios" valor={fila?.frios_na_fila ?? 0} classe="text-frio" />
        <Contador rotulo="Hoje" valor={fila?.enviados_hoje ?? 0} />
      </div>

      {chips.length > 1 && (
        <select
          value={chipId}
          onChange={(e) => aoTrocarChip(e.target.value)}
          className="rounded-lg border border-borda bg-superficie px-3 py-2 text-sm"
          aria-label="Número em uso"
        >
          {chips.map((c) => (
            <option key={c.id} value={c.id}>{c.rotulo}</option>
          ))}
        </select>
      )}

      <Botao variante="neutro" tamanho="p" onClick={aoSinalizar} title="Avisa o gestor e reduz seu ritmo">
        Meu WhatsApp está estranho
      </Botao>
    </Cartao>
  );
}

function Contador({ rotulo, valor, classe = '' }: { rotulo: string; valor: number; classe?: string }) {
  return (
    <div>
      <p className={`text-xl font-semibold tabular-nums ${classe}`}>{valor}</p>
      <p className="text-[11px] uppercase tracking-wide text-suave">{rotulo}</p>
    </div>
  );
}

// ── Cartão do atendimento ────────────────────────────────────────────────────

function CartaoAtendimento({
  contato, mensagem, fase, ocupado, refBotao, municipios, municipioId, encaminhamento,
  aoMudarMunicipio, aoMudarEncaminhamento, aoAbrir, aoMarcar, aoProximo,
}: {
  contato: ContatoDaFila;
  mensagem: MensagemPronta;
  fase: Fase;
  ocupado: boolean;
  refBotao: React.RefObject<HTMLButtonElement | null>;
  municipios: Municipio[];
  municipioId: number | '';
  encaminhamento: string;
  aoMudarMunicipio: (id: number | '') => void;
  aoMudarEncaminhamento: (v: string) => void;
  aoAbrir: () => void;
  aoMarcar: (r: Resultado) => void;
  aoProximo: () => void;
}) {
  const nome = contato.primeiro_nome ?? contato.nome ?? 'Sem nome';

  return (
    <Cartao className="overflow-hidden">
      <header className="flex flex-wrap items-center gap-3 border-b border-borda px-5 py-4">
        <div className="mr-auto">
          <h2 className="text-lg font-semibold">{nome}</h2>
          <p className="text-sm text-suave">
            {formatarExibicao(contato.telefone_e164)}
            {contato.municipio && ` · ${contato.municipio}`}
          </p>
        </div>
        <EtiquetaOrigem origem={contato.origem} />
      </header>

      <div className="px-5 py-4">
        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-suave">
          {TITULO_ETAPA[mensagem.etapa] ?? 'Mensagem'}
        </p>
        <div className="whitespace-pre-wrap rounded-lg border border-borda bg-fundo p-4 text-[15px] leading-relaxed">
          {mensagem.texto}
        </div>
        <p className="mt-2 text-xs text-suave">
          O texto abre já preenchido no WhatsApp. Ajuste ali se quiser antes de enviar.
        </p>
      </div>

      <div className="border-t border-borda px-5 py-4">
        <Botao ref={refBotao} tamanho="g" className="w-full" onClick={aoAbrir} disabled={ocupado}>
          Abrir conversa no WhatsApp
        </Botao>
      </div>

      {fase === 'aberta' && (
        <div className="border-t border-borda px-5 py-4">
          <p className="mb-3 text-sm font-medium">Depois de conversar, marque o resultado:</p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {RESULTADOS.map((r, i) => (
              <Botao
                key={r}
                variante={r === 'pediu_saida' ? 'perigo' : 'neutro'}
                onClick={() => aoMarcar(r)}
                disabled={ocupado}
                className="justify-between"
              >
                <span>{ROTULO_RESULTADO[r]}</span>
                <kbd className="rounded bg-fundo px-1.5 py-0.5 text-[10px] text-suave">{i + 1}</kbd>
              </Botao>
            ))}
          </div>

          <label className="mt-3 block">
            <span className="text-xs text-suave">
              Se for encaminhar, escreva em uma linha o que a pessoa pediu.
              Não escreva em quem ela vota — isso não pode ser registrado.
            </span>
            <input
              value={encaminhamento}
              onChange={(e) => aoMudarEncaminhamento(e.target.value)}
              maxLength={280}
              placeholder="ex.: perguntou sobre vaga de emprego"
              className="mt-1 w-full rounded-lg border border-borda bg-superficie px-3 py-2 text-sm"
            />
          </label>
        </div>
      )}

      {fase === 'seguimento' && (
        <div className="space-y-4 border-t border-borda px-5 py-4">
          <label className={mensagem.etapa === 'material' ? 'block' : 'hidden'}>
            <span className="mb-1.5 block text-sm font-medium">De qual cidade a pessoa é?</span>
            <select
              value={municipioId}
              onChange={(e) => aoMudarMunicipio(e.target.value ? Number(e.target.value) : '')}
              className="w-full rounded-lg border border-borda bg-superficie px-3 py-2.5 text-sm"
            >
              <option value="">Não informou</option>
              {municipios.map((m) => (
                <option key={m.id} value={m.id}>{m.nome}</option>
              ))}
            </select>
          </label>
          <Botao variante="neutro" tamanho="g" className="w-full" onClick={aoProximo} disabled={ocupado}>
            Próximo contato
          </Botao>
        </div>
      )}
    </Cartao>
  );
}

// ── Regras fixas na tela ─────────────────────────────────────────────────────

function Regras({ teto, inicio, fim }: { teto: number; inicio: number; fim: number }) {
  return (
    <Cartao className="p-4">
      <p className="mb-2 text-sm font-semibold">Cinco regras</p>
      <ol className="space-y-1.5 text-xs leading-relaxed text-suave">
        <li>1. Primeiro só o pedido de permissão.</li>
        <li>2. Material só depois do &ldquo;pode&rdquo;.</li>
        <li>3. Uma tentativa por pessoa. Nunca insista.</li>
        <li>4. &ldquo;Não&rdquo; é não: marque Pediu saída e agradeça.</li>
        <li>5. Até {teto} conversas, das {inicio}h às {fim}h.</li>
      </ol>
      <p className="mt-3 border-t border-borda pt-3 text-xs text-suave">
        Escreva como você fala. Não prometa nada a ninguém e não discuta política com quem responde mal.
      </p>
    </Cartao>
  );
}
