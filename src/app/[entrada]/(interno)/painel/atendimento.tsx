'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, Check, CircleSlash, Clock, Flame, Loader2, MessageSquare, PackageOpen,
  Send, Siren, Snowflake, SkipForward, Star,
} from 'lucide-react';
import { Aviso, Avatar, Botao, Cartao, EtiquetaOrigem, Pilula, Selecao, Vidro, cx } from '@/components/ui';
import { CHAVE_CHIP, useChipSalvo } from '@/components/chip-salvo';
import { ComoAgir } from '@/components/como-agir';
import { formatarExibicao } from '@/lib/telefone';
import {
  RESULTADOS, ROTULO_CARGO, TEXTO_MOTIVO,
  type Chip, type ContatoDaFila, type EntregaDoContato, type EtapaMsg, type FilaStatus,
  type Municipio, type Resultado,
} from '@/lib/tipos-banco';
import {
  carregarEntregas, consultarFila, definirMunicipio, pegarProximo, prepararMensagem,
  pularContato, registrarAbertura, registrarResultado, sinalizarChip, type MensagemPronta,
} from './acoes';

type Fase = 'ocioso' | 'permissao' | 'aberta' | 'entrega' | 'seguimento';

/**
 * A mensagem que cada resultado carrega (docs/03-OPERACAO.md §4).
 *
 * "Autorizou" NÃO está aqui: ele abre a fase de entrega, que tem uma mensagem
 * por candidato. "Número inválido" é o único sem seguimento nenhum.
 */
const SEGUIMENTO: Partial<Record<Resultado, EtapaMsg>> = {
  pediu_saida: 'saida',
  quer_ajudar: 'quer_ajudar',
  encaminhado: 'encaminhamento',
};

const TITULO_ETAPA: Partial<Record<EtapaMsg, string>> = {
  permissao: 'Primeira mensagem — só o pedido de permissão',
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

export function Atendimento({
  primeiroNome, chips, municipios, filaInicial,
}: {
  primeiroNome: string;
  chips: Chip[];
  municipios: Municipio[];
  filaInicial: FilaStatus | null;
}) {
  const [chipEscolhido, setChipEscolhido] = useState<string | null>(null);
  const chipSalvo = useChipSalvo();
  const [fila, setFila] = useState<FilaStatus | null>(filaInicial);
  const [contato, setContato] = useState<ContatoDaFila | null>(null);
  const [mensagem, setMensagem] = useState<MensagemPronta | null>(null);
  const [entregas, setEntregas] = useState<EntregaDoContato[]>([]);
  const [fase, setFase] = useState<Fase>('ocioso');
  const [espera, setEspera] = useState(filaInicial?.segundos_espera ?? 0);
  const [municipioId, setMunicipioId] = useState<number | ''>('');
  const [encaminhamento, setEncaminhamento] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const botaoAbrir = useRef<HTMLButtonElement>(null);
  const router = useRouter();
  const caminho = usePathname();
  const novo = useSearchParams().get('novo');

  const vivos = chips.filter((c) => c.status !== 'morto');
  const valido = (id: string | null) => (id && vivos.some((c) => c.id === id) ? id : null);
  const chipId = valido(chipEscolhido) ?? valido(chipSalvo) ?? vivos[0]?.id ?? '';
  const chip = vivos.find((c) => c.id === chipId);

  // O número que o atendente usava caiu. Ele precisa saber ANTES de tentar
  // trabalhar — e precisa saber o que fazer (docs/03-OPERACAO.md §2.5).
  const morto = chipSalvo ? chips.find((c) => c.id === chipSalvo && c.status === 'morto') : undefined;
  const reserva = vivos.find((c) => c.papel === 'reserva') ?? vivos[0];

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

  // Quando o intervalo termina, confirma com o SERVIDOR — o relógio do
  // navegador não decide nada, só mostra. O agendamento sai do tempo que o
  // servidor informou, para não depender de a aba estar em primeiro plano.
  useEffect(() => {
    if (fila?.motivo !== 'intervalo' || fila.segundos_espera <= 0) return;
    const t = setTimeout(() => void atualizarFila(), fila.segundos_espera * 1000 + 300);
    return () => clearTimeout(t);
  }, [fila, atualizarFila]);

  // Enquanto ocioso, reconsulta: a fila pode receber contatos novos e o
  // horário pode virar.
  useEffect(() => {
    if (fase !== 'ocioso') return;
    const t = setInterval(() => void atualizarFila(), 15000);
    return () => clearInterval(t);
  }, [fase, atualizarFila]);

  function buscarProximo() {
    // `setErro` fica DENTRO da transição para esta função poder ser chamada de
    // um efeito (a chegada pelo `?novo=`) sem disparar renderização em cascata.
    iniciar(async () => {
      setErro(null);
      const r = await pegarProximo(chipId);
      setFila(r.fila);
      setEspera(r.fila.segundos_espera);
      if (!r.ok) {
        setContato(null); setMensagem(null); setEntregas([]); setFase('ocioso');
        return;
      }
      setContato(r.contato);
      setMunicipioId(r.contato.municipio_id ?? '');
      setEncaminhamento('');
      setEntregas([]);

      const m = await prepararMensagem(r.contato.id, chipId, 'permissao');
      if (!m.ok) {
        setErro(`Não consegui montar a mensagem (${m.motivo}). Fale com o gestor.`);
        return;
      }
      setMensagem(m);
      setFase('permissao');
      setTimeout(() => botaoAbrir.current?.focus(), 60);
    });
  }

  function abrirConversa() {
    if (!contato || !mensagem) return;
    // window.open precisa ser síncrono no clique, senão o navegador bloqueia.
    window.open(mensagem.urlWhatsApp, JANELA_WA);
    setErro(null);
    const enviada = mensagem;
    iniciar(async () => {
      const r = await registrarAbertura(
        contato.id, chipId, enviada.etapa, enviada.texto, enviada.variacaoId,
        enviada.candidato?.id ?? null,
      );
      if (!r.ok) {
        setErro(`O sistema não registrou o envio: ${r.motivo}. Não continue — fale com o gestor.`);
        return;
      }
      setFila(r.fila);
      setEspera(r.fila.segundos_espera);

      if (enviada.etapa === 'permissao') { setFase('aberta'); return; }

      // Material de um candidato: risca aquele da lista e volta para ela, para
      // o atendente ver o que ainda falta sem perder o contexto.
      if (enviada.candidato) {
        const id = enviada.candidato.id;
        setEntregas((atual) => atual.map((c) =>
          c.candidato_id === id
            ? { ...c, material_enviado_em: c.material_enviado_em ?? new Date().toISOString() }
            : c,
        ));
        setMensagem(null);
      }
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
      if (!r.ok) { setErro(`Não consegui gravar o resultado: ${r.motivo}`); return; }

      // Autorizou: entra na entrega, uma mensagem por candidato declarado.
      if (resultado === 'autorizou') {
        setMensagem(null);
        setEntregas(await carregarEntregas(contato.id));
        setFase('entrega');
        return;
      }

      const etapa = SEGUIMENTO[resultado];
      if (etapa) {
        const m = await prepararMensagem(contato.id, chipId, etapa);
        if (m.ok) {
          setMensagem(m);
          setFase('seguimento');
          setTimeout(() => botaoAbrir.current?.focus(), 60);
          return;
        }
      }
      limparEBuscar();
    });
  }

  function prepararMaterial(candidatoId: string) {
    if (!contato) return;
    setErro(null); setMensagem(null);
    iniciar(async () => {
      const m = await prepararMensagem(contato.id, chipId, 'material', candidatoId);
      if (!m.ok) { setErro(MOTIVO_ENTREGA[m.motivo] ?? `Não consegui montar a mensagem (${m.motivo}).`); return; }
      setMensagem(m);
      setTimeout(() => botaoAbrir.current?.focus(), 60);
    });
  }

  function limparEBuscar() {
    setContato(null); setMensagem(null); setEntregas([]); setFase('ocioso');
    buscarProximo();
  }

  /**
   * "Buscar outro contato". A fila devolve sempre o contato que está na sua
   * mão — é o que impede recarregar a página de pular alguém —, então sem isto
   * quem abriu um contato e não vai falar com ele agora fica preso nele.
   */
  function pularEBuscar() {
    if (!contato) return;
    setErro(null);
    const id = contato.id;
    iniciar(async () => {
      const r = await pularContato(id, chipId);
      if (!r.ok) { setErro(`Não consegui soltar este contato: ${r.motivo}`); return; }
      setAviso(r.destino === 'aguardando_resposta'
        ? 'Você já tinha falado com essa pessoa, então ela ficou em Meus contatos aguardando resposta.'
        : 'Contato devolvido para a fila. Ele não volta para você nas próximas 2 horas.');
      limparEBuscar();
    });
  }

  /**
   * Chegou do botão "Adicionar contato" (`?novo=`): já abre a conversa.
   *
   * Não consome ninguém da fila. O contato acabou de ser criado EM ATENDIMENTO
   * para este atendente, e `pegar_proximo_contato` devolve o que já está na mão
   * antes de olhar a fila — o mesmo caminho de quem recarrega a página.
   *
   * Lê pelo `useSearchParams`, e não uma vez na montagem, porque quem clica no
   * botão flutuante quase sempre JÁ ESTÁ nesta tela: ali a navegação só troca o
   * parâmetro, o componente não remonta, e um efeito de montagem nunca rodaria.
   *
   * O `ref` cobre a dupla execução do modo estrito e é zerado quando o
   * parâmetro sai da URL — sem isso, cadastrar a MESMA pessoa de novo (que é o
   * que acontece quando ela volta a escrever) não abriria a conversa.
   */
  const novoTratado = useRef<string | null>(null);
  useEffect(() => {
    if (!novo) { novoTratado.current = null; return; }
    if (!chipId || novoTratado.current === novo) return;
    novoTratado.current = novo;
    // Tira da URL: recarregar depois não pode reabrir nada.
    router.replace(caminho);
    buscarProximo();
    // buscarProximo depende de estado que muda a cada passo do atendimento;
    // listá-lo aqui faria o efeito rodar de novo no meio da conversa.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [novo, chipId]);

  // Atalhos de teclado: são 30 conversas por dia, o mouse cansa.
  useEffect(() => {
    function aoTeclar(e: KeyboardEvent) {
      const alvo = e.target as HTMLElement;
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(alvo.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (fase === 'aberta') {
        const i = Number(e.key) - 1;
        if (i >= 0 && i < RESULTADOS.length) { e.preventDefault(); marcar(RESULTADOS[i]); }
      }
    }
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  });

  if (vivos.length === 0) {
    return (
      <Aviso tom="alerta" icone={<AlertTriangle size={16} />}>
        {chips.length === 0
          ? 'Você ainda não tem nenhum número cadastrado. Peça ao gestor para cadastrar o seu Chip A.'
          : 'Todos os seus números foram desativados. Fale com o gestor antes de continuar.'}
      </Aviso>
    );
  }

  const travado = fila && !fila.pode && fase === 'ocioso';

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0 space-y-5">
        <Barra
          primeiroNome={primeiroNome} fila={fila} chips={vivos} chipId={chipId}
          aoTrocarChip={trocarChip}
          aoSinalizar={() => iniciar(async () => { await sinalizarChip(chipId); await atualizarFila(); })}
        />

        {morto && (
          <Aviso tom="erro" icone={<CircleSlash size={16} />}>
            <strong>Seu {morto.rotulo} foi desativado.</strong>{' '}
            {reserva
              ? `Feche esta janela e abra o atalho do ${reserva.rotulo}. As conversas que estavam no ${morto.rotulo} não voltam — quem respondeu por lá não chega mais até você.`
              : 'Fale com o gestor: você não tem outro número disponível.'}
          </Aviso>
        )}

        {erro && <Aviso tom="erro" icone={<AlertTriangle size={16} />}>{erro}</Aviso>}
        {aviso && <Aviso tom="info">{aviso}</Aviso>}

        {chip?.status === 'amarelo' && (
          <Aviso tom="alerta" icone={<Siren size={16} />}>
            Seu número está marcado como <strong>atenção</strong>. Vá mais devagar e avise o gestor.
          </Aviso>
        )}

        {travado && <Travado fila={fila} espera={espera} />}

        {!travado && fase === 'ocioso' && (
          <Cartao className="px-6 py-14 text-center" elevado>
            <p className="font-display text-2xl font-semibold tracking-tight">Pronto para começar</p>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-suave">
              {fila?.quentes_na_fila
                ? `Comece pelos ${fila.quentes_na_fila} cadastros novos — são pessoas que pediram contato.`
                : `${fila?.frios_na_fila ?? 0} contatos na fila.`}
            </p>
            <Botao tamanho="g" className="mt-7" onClick={buscarProximo} disabled={ocupado}>
              {ocupado
                ? <><Loader2 size={17} className="animate-spin" /> Buscando…</>
                : 'Buscar próximo contato'}
            </Botao>
          </Cartao>
        )}

        {contato && fase !== 'ocioso' && (
          <CartaoAtendimento
            contato={contato} mensagem={mensagem} fase={fase} ocupado={ocupado}
            entregas={entregas} refBotao={botaoAbrir}
            municipios={municipios} municipioId={municipioId}
            encaminhamento={encaminhamento}
            aoMudarMunicipio={(id) => {
              setMunicipioId(id);
              if (id) iniciar(async () => { await definirMunicipio(contato.id, id); });
            }}
            aoMudarEncaminhamento={setEncaminhamento}
            aoAbrir={abrirConversa} aoMarcar={marcar} aoProximo={limparEBuscar}
            aoPular={pularEBuscar} aoPrepararMaterial={prepararMaterial}
          />
        )}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <Regras teto={fila?.teto_hoje ?? 30} inicio={fila?.hora_inicio ?? 9} fim={fila?.hora_fim ?? 20} />
        <ComoAgir />
      </aside>
    </div>
  );
}

/** Motivos que o servidor devolve na entrega, em português de gente. */
const MOTIVO_ENTREGA: Record<string, string> = {
  candidato_nao_declarado:
    'Esta pessoa não foi avisada deste candidato na primeira mensagem, então não dá para mandar o material dele. ' +
    'Ela só autorizou o que estava escrito lá.',
  candidato_inativo: 'Este candidato foi desativado pelo gestor.',
  sem_endereco:
    'O sistema não sabe o endereço público do painel, então o link do material sairia quebrado. ' +
    'Não mande nada — avise o gestor para configurar LINK_BASE_URL.',
  candidato_obrigatorio: 'Escolha de qual candidato é o material.',
  contato_bloqueado: 'Esta pessoa pediu para sair. Não dá para mandar mais nada.',
  modelo_ausente: 'Não existe modelo de material cadastrado. Fale com o gestor.',
  sem_variacao: 'O modelo de material está sem texto. Fale com o gestor.',
};

/* ── Barra de contadores ─────────────────────────────────────────────────── */

function Barra({
  primeiroNome, fila, chips, chipId, aoTrocarChip, aoSinalizar,
}: {
  primeiroNome: string; fila: FilaStatus | null; chips: Chip[]; chipId: string;
  aoTrocarChip: (id: string) => void; aoSinalizar: () => void;
}) {
  const feito = fila ? fila.enviados_hoje : 0;
  const teto = fila?.teto_hoje ?? 0;
  const pct = teto > 0 ? Math.min(100, (feito / teto) * 100) : 0;

  return (
    <Vidro className="p-5">
      <div className="flex flex-wrap items-center gap-x-8 gap-y-4">
        <div className="flex items-center gap-3">
          <Avatar nome={primeiroNome} />
          <div>
            <p className="font-display text-lg font-semibold leading-tight tracking-tight">
              Olá, {primeiroNome}
            </p>
            <p className="text-xs text-suave">
              {fila ? `${fila.restante_hoje} de ${teto} conversas restantes hoje` : '—'}
            </p>
          </div>
        </div>

        <div className="ml-auto flex items-center gap-6">
          <Contador rotulo="Quentes" valor={fila?.quentes_na_fila ?? 0} cor="text-quente" icone={<Flame size={12} />} />
          <Contador rotulo="Frios" valor={fila?.frios_na_fila ?? 0} cor="text-frio" icone={<Snowflake size={12} />} />
          <Contador rotulo="Hoje" valor={feito} />
        </div>

        <div className="flex w-full items-center gap-2 border-t border-borda pt-4 sm:w-auto sm:border-0 sm:pt-0">
        {chips.length > 1 && (
          <Selecao compacto value={chipId} onChange={(e) => aoTrocarChip(e.target.value)}
                   aria-label="Número em uso">
            {chips.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
          </Selecao>
        )}

        <Botao variante="neutro" tamanho="p" onClick={aoSinalizar}
               title="Avisa o gestor e reduz seu ritmo">
          <Siren size={13} /> WhatsApp estranho
        </Botao>
        </div>
      </div>

      {/* Quanto do dia já foi. Enxergar o próprio ritmo evita tanto o atendente
          que corre demais quanto o que para cedo sem perceber. */}
      <div className="mt-4 h-1 overflow-hidden rounded-full bg-superficie-alta">
        <div className="h-full rounded-full bg-acento transition-[width] duration-500"
             style={{ width: `${pct}%` }} />
      </div>
    </Vidro>
  );
}

function Contador({ rotulo, valor, cor, icone }: {
  rotulo: string; valor: number; cor?: string; icone?: React.ReactNode;
}) {
  return (
    <div className="text-center">
      <p className={cx('font-display text-2xl font-semibold leading-none tabular', cor ?? 'text-texto')}>
        {valor}
      </p>
      <p className="mt-1.5 flex items-center justify-center gap-1 text-[10px] font-semibold uppercase tracking-[0.08em] text-suave">
        {icone}{rotulo}
      </p>
    </div>
  );
}

/* ── Estado travado ──────────────────────────────────────────────────────── */

function Travado({ fila, espera }: { fila: FilaStatus; espera: number }) {
  const total = fila.intervalo_seg || 1;
  const volta = 2 * Math.PI * 52;
  const restante = Math.max(0, Math.min(1, espera / total));

  return (
    <Cartao className="px-6 py-12 text-center" elevado>
      {fila.motivo === 'intervalo' ? (
        <>
          <div className="relative mx-auto size-32">
            <svg viewBox="0 0 120 120" className="size-full -rotate-90">
              <circle cx="60" cy="60" r="52" fill="none" strokeWidth="6"
                      className="stroke-superficie-alta" />
              <circle cx="60" cy="60" r="52" fill="none" strokeWidth="6" strokeLinecap="round"
                      className="stroke-acento transition-[stroke-dashoffset] duration-1000 ease-linear"
                      strokeDasharray={volta} strokeDashoffset={volta * (1 - restante)} />
            </svg>
            <span className="absolute inset-0 grid place-items-center font-display text-3xl font-semibold tabular">
              {espera}
            </span>
          </div>
          <p className="mt-6 font-display text-xl font-semibold tracking-tight">
            Aguarde o intervalo
          </p>
          <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-suave">
            O intervalo existe para o WhatsApp não ler seu número como disparo.
          </p>
        </>
      ) : (
        <>
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-superficie-alta text-suave">
            <Clock size={22} />
          </span>
          <p className="mt-5 font-display text-xl font-semibold tracking-tight">
            {TEXTO_MOTIVO[fila.motivo]}
          </p>
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
        </>
      )}
    </Cartao>
  );
}

/* ── Cartão do atendimento ───────────────────────────────────────────────── */

function CartaoAtendimento({
  contato, mensagem, fase, ocupado, entregas, refBotao, municipios, municipioId, encaminhamento,
  aoMudarMunicipio, aoMudarEncaminhamento, aoAbrir, aoMarcar, aoProximo, aoPular,
  aoPrepararMaterial,
}: {
  contato: ContatoDaFila; mensagem: MensagemPronta | null; fase: Fase; ocupado: boolean;
  entregas: EntregaDoContato[];
  refBotao: React.RefObject<HTMLButtonElement | null>;
  municipios: Municipio[]; municipioId: number | ''; encaminhamento: string;
  aoMudarMunicipio: (id: number | '') => void;
  aoMudarEncaminhamento: (v: string) => void;
  aoAbrir: () => void; aoMarcar: (r: Resultado) => void; aoProximo: () => void;
  aoPular: () => void; aoPrepararMaterial: (candidatoId: string) => void;
}) {
  const nome = contato.primeiro_nome ?? contato.nome ?? 'Sem nome';
  const titulo = mensagem?.candidato
    ? `Material de ${mensagem.candidato.nome}`
    : (mensagem ? TITULO_ETAPA[mensagem.etapa] ?? 'Mensagem' : '');

  return (
    <Cartao className="overflow-hidden" elevado>
      <header className="flex flex-wrap items-center gap-4 border-b border-borda px-6 py-5">
        <Avatar nome={contato.nome ?? nome} tamanho="g" />
        <div className="mr-auto min-w-0">
          <h2 className="font-display text-2xl font-semibold tracking-tight">{nome}</h2>
          <p className="mt-0.5 truncate text-sm text-suave">
            {formatarExibicao(contato.telefone_e164)}
            {contato.municipio && ` · ${contato.municipio}`}
          </p>
        </div>
        <EtiquetaOrigem origem={contato.origem} />
      </header>

      {fase === 'entrega' && (
        <Entrega entregas={entregas} ocupado={ocupado} escolhido={mensagem?.candidato?.id ?? null}
                 aoPreparar={aoPrepararMaterial} />
      )}

      {mensagem && (
        <>
          <div className="px-6 py-5">
            <p className="mb-3 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
              <MessageSquare size={12} />
              {titulo}
            </p>
            <div className="rounded-2xl rounded-tl-md border border-borda bg-superficie-alta p-5 text-[15px] leading-[1.7] whitespace-pre-wrap">
              {mensagem.texto}
            </div>
            <p className="mt-2.5 text-xs text-suave">
              O texto abre já preenchido no WhatsApp. Ajuste ali se quiser antes de enviar.
            </p>
          </div>

          <div className="border-t border-borda px-6 py-5">
            <Botao ref={refBotao} tamanho="g" className="w-full" onClick={aoAbrir} disabled={ocupado}>
              {ocupado
                ? <><Loader2 size={17} className="animate-spin" /> Registrando…</>
                : <><Send size={17} /> Abrir conversa no WhatsApp</>}
            </Botao>
          </div>
        </>
      )}

      {fase === 'aberta' && (
        <div className="border-t border-borda px-6 py-5">
          <p className="mb-3.5 text-sm font-semibold">Depois de conversar, marque o resultado:</p>
          <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
            {RESULTADOS.map((r, i) => (
              <Botao key={r} variante={r === 'pediu_saida' ? 'perigo' : 'neutro'}
                     onClick={() => aoMarcar(r)} disabled={ocupado}
                     className="justify-between !rounded-2xl py-3">
                <span>{ROTULO_RESULTADO[r]}</span>
                <kbd className="rounded-md border border-borda bg-fundo px-1.5 py-0.5 font-sans text-[10px] text-suave">
                  {i + 1}
                </kbd>
              </Botao>
            ))}
          </div>

          <label className="mt-4 block">
            <span className="text-xs leading-relaxed text-suave">
              Se for encaminhar, escreva em uma linha o que a pessoa pediu.
              Não escreva em quem ela vota — isso não pode ser registrado.
            </span>
            <input
              value={encaminhamento} onChange={(e) => aoMudarEncaminhamento(e.target.value)}
              maxLength={280} placeholder="ex.: perguntou sobre vaga de emprego"
              className="mt-2 w-full rounded-2xl border border-borda bg-superficie-alta px-4 py-2.5 text-sm placeholder:text-tenue"
            />
          </label>
        </div>
      )}

      {(fase === 'entrega' || fase === 'seguimento') && (
        <div className="space-y-4 border-t border-borda px-6 py-5">
          {fase === 'entrega' && (
            <Selecao rotulo="De qual cidade a pessoa é?" value={municipioId}
                     onChange={(e) => aoMudarMunicipio(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Não informou</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </Selecao>
          )}
          <Botao variante="neutro" tamanho="g" className="w-full" onClick={aoProximo} disabled={ocupado}>
            {ocupado
              ? <><Loader2 size={16} className="animate-spin" /> Buscando…</>
              : <><SkipForward size={16} /> Próximo contato</>}
          </Botao>
        </div>
      )}

      {/* Sair deste contato sem encerrar. A fila devolve sempre quem está na
          sua mão, então sem esta saída quem abriu um contato e não vai falar
          com ele agora pede o próximo e recebe o mesmo, indefinidamente. */}
      {fase !== 'entrega' && fase !== 'seguimento' && (
        <div className="border-t border-borda px-6 py-4 text-center">
          <button type="button" onClick={aoPular} disabled={ocupado}
                  className="inline-flex items-center gap-1.5 text-xs text-suave transition-colors hover:text-texto disabled:opacity-45">
            {ocupado
              ? <><Loader2 size={12} className="animate-spin" /> soltando…</>
              : <><SkipForward size={12} /> Deixar este para depois e buscar outro contato</>}
          </button>
        </div>
      )}
    </Cartao>
  );
}

/* ── Entrega do material, um candidato por vez ───────────────────────────── */

/**
 * A lista sai de `contato_candidato`: os candidatos que ESTA pessoa ouviu na
 * primeira mensagem. Não é a chapa atual do atendente — quem entrou depois não
 * aparece, porque ela nunca foi avisada dele.
 */
function Entrega({
  entregas, ocupado, escolhido, aoPreparar,
}: {
  entregas: EntregaDoContato[]; ocupado: boolean; escolhido: string | null;
  aoPreparar: (candidatoId: string) => void;
}) {
  if (entregas.length === 0) {
    return (
      <div className="px-6 py-5">
        <Aviso tom="alerta" icone={<AlertTriangle size={16} />}>
          Não há candidato liberado para esta pessoa. Isso acontece quando a primeira mensagem
          não chegou a ser registrada, ou quando você ainda não tem candidato atribuído.
          Fale com o gestor.
        </Aviso>
      </div>
    );
  }

  const faltam = entregas.filter((c) => !c.material_enviado_em).length;

  return (
    <div className="px-6 py-5">
      <p className="mb-1 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
        <PackageOpen size={12} /> Material — um por candidato
      </p>
      <p className="mb-4 text-xs leading-relaxed text-suave">
        {faltam === 0
          ? 'Tudo entregue. Pode seguir para o próximo contato.'
          : 'Mande um de cada vez e espere a resposta. Emendar vários materiais seguidos é o que derruba número.'}
      </p>

      <div className="space-y-2">
        {entregas.map((c) => {
          const enviado = c.material_enviado_em !== null;
          const semPeca = c.materiais === 0;
          const bloqueado = ocupado || semPeca || !c.ativo;
          return (
            <div key={c.candidato_id}
                 className={cx(
                   'flex flex-wrap items-center gap-3 rounded-2xl border p-3.5 transition-colors',
                   escolhido === c.candidato_id
                     ? 'border-acento/50 bg-acento/10'
                     : enviado ? 'border-borda bg-superficie-alta/50' : 'border-borda',
                 )}>
              <div className="mr-auto min-w-0">
                <p className="flex items-center gap-2 text-sm font-semibold">
                  {c.nome_urna}
                  {c.principal && (
                    <span title="Citado na primeira mensagem" className="text-acento">
                      <Star size={12} fill="currentColor" />
                    </span>
                  )}
                </p>
                <p className="mt-0.5 text-xs text-suave">
                  {ROTULO_CARGO[c.cargo]} · nº {c.numero}
                  {c.partido_sigla && ` · ${c.partido_sigla}`}
                </p>
              </div>

              {!c.ativo && <Pilula cor="alerta">desativado</Pilula>}
              {c.ativo && semPeca && <Pilula cor="alerta">sem material</Pilula>}
              {enviado && <Pilula cor="acento"><Check size={11} /> enviado</Pilula>}

              <Botao variante={enviado ? 'neutro' : 'principal'} tamanho="p"
                     disabled={bloqueado} onClick={() => aoPreparar(c.candidato_id)}>
                {enviado ? 'Mandar de novo' : 'Preparar material'}
              </Botao>
            </div>
          );
        })}
      </div>

      {entregas.some((c) => c.materiais === 0 && c.ativo) && (
        <p className="mt-3 text-xs leading-relaxed text-alerta">
          Candidato sem peça cadastrada não tem o que mandar — a mensagem sairia anunciando
          material e sem link nenhum. Peça ao gestor para cadastrar os materiais dele.
        </p>
      )}
    </div>
  );
}

/* ── Regras fixas ────────────────────────────────────────────────────────── */

function Regras({ teto, inicio, fim }: { teto: number; inicio: number; fim: number }) {
  const regras = [
    'Primeiro só o pedido de permissão.',
    'Material só depois do “pode”.',
    'Uma tentativa por pessoa. Nunca insista.',
    '“Não” é não: marque Pediu saída e agradeça.',
    `Até ${teto} conversas, das ${inicio}h às ${fim}h.`,
  ];
  return (
    <Cartao className="p-5">
      <p className="mb-3.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
        Cinco regras
      </p>
      <ol className="space-y-2.5">
        {regras.map((r, i) => (
          <li key={r} className="flex gap-2.5 text-xs leading-relaxed text-suave">
            <span className="grid size-4 shrink-0 place-items-center rounded-full bg-superficie-alta text-[9px] font-bold text-texto">
              {i + 1}
            </span>
            {r}
          </li>
        ))}
      </ol>
      <p className="mt-4 border-t border-borda pt-4 text-xs leading-relaxed text-suave">
        Escreva como você fala. Não prometa nada a ninguém e não discuta política com quem responde mal.
      </p>
    </Cartao>
  );
}
