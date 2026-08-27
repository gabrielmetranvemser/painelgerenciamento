'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, Check, CircleSlash, Clock, Flame, Layers, Loader2, MessageSquare, PackageOpen,
  Send, Siren, Snowflake, SkipForward, Star,
} from 'lucide-react';
import {
  Aviso, Avatar, Botao, Cartao, EtiquetaLista, EtiquetaOrigem, Pilula, PontoLista, Selecao,
  Vidro, cx,
} from '@/components/ui';
import { guardarChip, useChipSalvo } from '@/components/chip-salvo';
import { guardarLista, useListaSalva } from '@/components/lista-salva';
import { ComoAgir } from '@/components/como-agir';
import { formatarExibicao } from '@/lib/telefone';
import {
  RESULTADOS, ROTULO_CARGO, TEXTO_MOTIVO,
  type Chip, type ContatoDaFila, type EntregaDoContato, type EtapaMsg, type FilaStatus,
  type ListaDoAtendente, type Municipio, type Resultado,
} from '@/lib/tipos-banco';
import {
  carregarEntregas, carregarMinhasListas, consultarFila, definirMunicipio, pegarProximo,
  prepararMensagem, pularContato, registrarAbertura, registrarResultado, sinalizarChip,
  type MensagemPronta,
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

/**
 * As etapas em que o intervalo vale — as mesmas de `etapa_de_abordagem()` no
 * banco. As outras são resposta a quem acabou de escrever, e fazer o atendente
 * esperar para responder é o que faz ELE parecer robô.
 *
 * Isto aqui é espelho da trava, não a trava: quem decide é o servidor.
 */
const ETAPAS_DE_ABORDAGEM: EtapaMsg[] = ['permissao', 'material', 'convite_grupo'];

export function Atendimento({
  primeiroNome, chips, municipios, filaInicial, aguardandoInicial, listasIniciais,
  rotaMeusContatos,
}: {
  primeiroNome: string;
  chips: Chip[];
  municipios: Municipio[];
  filaInicial: FilaStatus | null;
  /** Conversas abertas esperando resposta, no carregamento da página. */
  aguardandoInicial: number;
  /** As listas que este atendente atende, com o que falta em cada uma. */
  listasIniciais: ListaDoAtendente[];
  rotaMeusContatos: string;
}) {
  const [chipEscolhido, setChipEscolhido] = useState<string | null>(null);
  const chipSalvo = useChipSalvo();
  const [listas, setListas] = useState<ListaDoAtendente[]>(listasIniciais);
  const [listaEscolhida, setListaEscolhida] = useState<string | null>(null);
  const listaSalva = useListaSalva();
  const [fila, setFila] = useState<FilaStatus | null>(filaInicial);
  const [contato, setContato] = useState<ContatoDaFila | null>(null);
  const [mensagem, setMensagem] = useState<MensagemPronta | null>(null);
  const [entregas, setEntregas] = useState<EntregaDoContato[]>([]);
  const [fase, setFase] = useState<Fase>('ocioso');
  const [espera, setEspera] = useState(filaInicial?.segundos_espera ?? 0);
  const [municipioId, setMunicipioId] = useState<number | ''>('');
  const [encaminhamento, setEncaminhamento] = useState('');
  const [confirmandoSaida, setConfirmandoSaida] = useState(false);
  const [aguardando, setAguardando] = useState(aguardandoInicial);
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

  /**
   * A lista escolhida, ou `null` para "todas".
   *
   * A escolha guardada só vale se a lista ainda for dele: o gestor pode ter
   * tirado a lista ou pausado ela desde ontem, e insistir num id morto faria a
   * tela pedir contato de uma lista que o servidor recusa a cada clique.
   */
  const listaValida = (id: string | null) => (id && listas.some((l) => l.id === id) ? id : null);
  const listaId = listaValida(listaEscolhida) ?? listaValida(listaSalva);
  const lista = listas.find((l) => l.id === listaId);

  function trocarChip(id: string) {
    setChipEscolhido(id);
    guardarChip(id);
  }

  /**
   * Reconsulta a fila.
   *
   * O parâmetro existe por causa da troca de lista: dentro do mesmo clique, o
   * `listaId` fechado nesta função ainda é o ANTERIOR — o React só recalcula na
   * renderização seguinte. Quem troca passa o novo id na mão; o resto chama sem
   * argumento e usa o atual.
   */
  const atualizarFila = useCallback(async (lista: string | null = listaId) => {
    if (!chipId) return;
    const [f, ls] = await Promise.all([consultarFila(chipId, lista), carregarMinhasListas()]);
    setFila(f);
    setEspera(f.segundos_espera);
    // As contagens por lista envelhecem junto com a fila — inclusive por causa
    // do trabalho dos colegas que atendem a mesma lista.
    setListas(ls);
  }, [chipId, listaId]);

  function trocarLista(id: string | null) {
    setListaEscolhida(id);
    guardarLista(id);
    // Reconsulta no próprio clique, e não num efeito: os contadores do topo
    // passam a ser os daquela lista na hora.
    iniciar(async () => { await atualizarFila(id); });
  }

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
      const r = await pegarProximo(chipId, listaId);
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

  /**
   * Abre a conversa — só DEPOIS de o servidor autorizar.
   *
   * ⚠️ A ordem aqui é a correção de um defeito real: antes, `window.open` com a
   * URL do WhatsApp vinha primeiro e o `await` do servidor vinha depois. Quando
   * a resposta era "não" — pessoa bloqueada, fora do horário, dia da eleição —
   * a janela já estava aberta com o texto pronto, e a única coisa entre aquilo
   * e um envio indevido era o atendente ler o aviso vermelho na aba de trás.
   *
   * `window.open` continua síncrono no clique, senão o navegador trata como
   * pop-up e bloqueia. O truque é abrir com URL VAZIA: uma janela nomeada que
   * já exista não é navegada nesse caso, então a aba de WhatsApp em uso não é
   * atropelada, e é só depois do "ok" que ela recebe o endereço.
   */
  function abrirConversa() {
    if (!contato || !mensagem) return;
    const janela = window.open('', JANELA_WA);
    setErro(null);
    const enviada = mensagem;
    iniciar(async () => {
      const r = await registrarAbertura(
        contato.id, chipId, enviada.etapa, enviada.variacaoId,
        enviada.candidato?.id ?? null,
      );
      if (!r.ok) {
        // Não navega: o texto não chega ao WhatsApp.
        setErro(
          MOTIVO_ENVIO[r.motivo] ??
          `O sistema não registrou o envio: ${r.motivo}. Não envie nada — fale com o gestor.`,
        );
        // Teto e intervalo mudam com o tempo: a tela precisa mostrar a espera.
        await atualizarFila();
        return;
      }
      if (janela && !janela.closed) janela.location.href = enviada.urlWhatsApp;
      else window.open(enviada.urlWhatsApp, JANELA_WA);
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

  /**
   * Marca o resultado.
   *
   * "Pediu saída" pede confirmação, e só ele. Os outros quatro se corrigem à
   * vontade no perfil do contato; este cria bloqueio permanente e agenda o
   * apagamento dos dados, e desde a migration 340300 desfazê-lo passou a
   * depender do gestor. Com atalho de teclado no meio de 30 conversas por dia,
   * um "2" apertado sem querer custava caro demais para ser um clique só.
   */
  function marcar(resultado: Resultado) {
    if (!contato || fase !== 'aberta') return;
    if (resultado === 'encaminhado' && !encaminhamento.trim()) {
      setErro('Escreva em uma linha o que a pessoa pediu, para a equipe saber o que encaminhar.');
      return;
    }
    if (resultado === 'pediu_saida' && !confirmandoSaida) {
      setConfirmandoSaida(true);
      setErro(null);
      return;
    }
    setConfirmandoSaida(false);
    setErro(null);
    iniciar(async () => {
      // O campo livre só acompanha "Encaminhar". Antes ia em todo resultado:
      // quem digitasse uma anotação e depois clicasse em "Pediu saída" gravava
      // texto livre na ficha de alguém que acabou de pedir para sair — e o campo
      // livre é o único lugar do sistema onde caberia, por engano, uma anotação
      // que não pode existir.
      const r = await registrarResultado(
        contato.id, resultado, municipioId || null,
        resultado === 'encaminhado' ? encaminhamento : null,
      );
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
      if (!m.ok) { setErro(MOTIVO_ENVIO[m.motivo] ?? `Não consegui montar a mensagem (${m.motivo}).`); return; }
      setMensagem(m);
      setTimeout(() => botaoAbrir.current?.focus(), 60);
    });
  }

  function limparEBuscar() {
    setContato(null); setMensagem(null); setEntregas([]); setFase('ocioso');
    setConfirmandoSaida(false);
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
      if (r.destino === 'aguardando_resposta') setAguardando((n) => n + 1);
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
          aguardando={aguardando} rotaMeusContatos={rotaMeusContatos}
          aoTrocarChip={trocarChip}
          aoSinalizar={() => iniciar(async () => { await sinalizarChip(chipId); await atualizarFila(); })}
        />

        <FaixaDeListas
          listas={listas} escolhida={listaId}
          bloqueada={ocupado || fase !== 'ocioso'}
          aoEscolher={trocarLista}
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

        {travado && (
          <Travado
            fila={fila} espera={espera}
            listaEscolhida={lista?.rotulo ?? null}
            aoVerTodas={() => trocarLista(null)}
          />
        )}

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
            entregas={entregas} refBotao={botaoAbrir} espera={espera}
            confirmandoSaida={confirmandoSaida}
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

/**
 * Motivos que o servidor devolve, em português de gente.
 *
 * Serve tanto para a montagem da mensagem quanto para a hora de abrir a
 * conversa: as duas funções do banco recusam pelos mesmos motivos, e ter dois
 * dicionários faria uma delas cair no texto cru mais cedo ou mais tarde.
 */
const MOTIVO_ENVIO: Record<string, string> = {
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
  dia_bloqueado: 'Hoje é dia bloqueado — não se fala com ninguém. Nada foi enviado.',
  fora_de_horario: 'O horário de atendimento acabou. Nada foi enviado; continue amanhã.',
  chip_indisponivel: 'Seu número está pausado ou foi desativado. Nada foi enviado — fale com o gestor.',
  teto_atingido: 'Você chegou ao limite de conversas deste número hoje. Nada foi enviado.',
  intervalo: 'Ainda falta o intervalo entre uma abordagem e outra. Nada foi enviado — espere a contagem.',
  dados_apagados: 'Os dados desta pessoa já foram apagados. Não há para quem mandar.',
  contato_nao_e_seu: 'Este contato não está mais com você. Busque o próximo.',
  chip_nao_e_seu: 'Esse número não está no seu cadastro. Fale com o gestor.',
};

/* ── Barra de contadores ─────────────────────────────────────────────────── */

function Barra({
  primeiroNome, fila, chips, chipId, aguardando, rotaMeusContatos, aoTrocarChip, aoSinalizar,
}: {
  primeiroNome: string; fila: FilaStatus | null; chips: Chip[]; chipId: string;
  aguardando: number; rotaMeusContatos: string;
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

        {aguardando > 0 && (
          <Link href={rotaMeusContatos}
                className="flex w-full items-center gap-2 rounded-2xl border border-borda bg-superficie-alta px-3.5 py-2.5 text-sm transition-colors hover:border-borda-forte sm:w-auto">
            <Clock size={14} className="shrink-0 text-suave" />
            <span className="tabular font-semibold">{aguardando}</span>
            <span className="text-suave">
              {aguardando === 1 ? 'esperando resposta' : 'esperando resposta'}
            </span>
          </Link>
        )}

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

function Travado({
  fila, espera, listaEscolhida, aoVerTodas,
}: {
  fila: FilaStatus;
  espera: number;
  /** O nome da lista sendo trabalhada, quando o atendente escolheu uma só. */
  listaEscolhida: string | null;
  aoVerTodas: () => void;
}) {
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
          {fila.motivo === 'sem_lista' && (
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-suave">
              A base tem contatos — eles é que estão em listas que ainda não são suas. Quem
              escolhe é o gestor: peça a ele para marcar suas listas.
            </p>
          )}
          {/* Fila vazia trabalhando UMA lista quase nunca quer dizer "acabou o
              dia": quer dizer que aquela lista acabou. O caminho de volta tem
              de estar aqui, e não escondido lá em cima. */}
          {(fila.motivo === 'fila_vazia' || fila.motivo === 'lista_nao_e_sua') && listaEscolhida && (
            <>
              <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-suave">
                {fila.motivo === 'lista_nao_e_sua'
                  ? `A lista “${listaEscolhida}” não está mais com você.`
                  : `Não há mais ninguém esperando em “${listaEscolhida}”. Suas outras listas continuam de pé.`}
              </p>
              <Botao className="mt-5" variante="neutro" onClick={aoVerTodas}>
                <Layers size={15} /> Voltar para todas as listas
              </Botao>
            </>
          )}
        </>
      )}
    </Cartao>
  );
}

/* ── Cartão do atendimento ───────────────────────────────────────────────── */

function CartaoAtendimento({
  contato, mensagem, fase, ocupado, entregas, refBotao, municipios, municipioId, encaminhamento,
  espera, confirmandoSaida, aoMudarMunicipio, aoMudarEncaminhamento, aoAbrir, aoMarcar,
  aoProximo, aoPular, aoPrepararMaterial,
}: {
  contato: ContatoDaFila; mensagem: MensagemPronta | null; fase: Fase; ocupado: boolean;
  entregas: EntregaDoContato[];
  /** Segundos que faltam do intervalo. Trava os botões de abordagem. */
  espera: number;
  /** "Pediu saída" armado, esperando o segundo clique. */
  confirmandoSaida: boolean;
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

  // O servidor recusa abordagem dentro do intervalo. A tela desabilita antes,
  // para o atendente não clicar num botão que só devolve erro — e para a
  // rajada de material (um por candidato) sair espaçada, que é a razão de o
  // intervalo existir.
  const noIntervalo = espera > 0;
  const travadoPorIntervalo = noIntervalo && !!mensagem && ETAPAS_DE_ABORDAGEM.includes(mensagem.etapa);

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
        <div className="flex flex-wrap items-center gap-2">
          <EtiquetaOrigem origem={contato.origem} />
          {/* De qual lista veio. Sem isto, quem atende três listas não sabe se
              está falando com quem pediu o kit ou com quem um apoiador
              indicou — e o tom da conversa é outro. */}
          {contato.lista_id && contato.lista && (
            <EtiquetaLista id={contato.lista_id} nome={contato.lista} />
          )}
        </div>
      </header>

      {fase === 'entrega' && (
        <Entrega entregas={entregas} ocupado={ocupado} espera={espera}
                 escolhido={mensagem?.candidato?.id ?? null}
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
            <Botao ref={refBotao} tamanho="g" className="w-full" onClick={aoAbrir}
                   disabled={ocupado || travadoPorIntervalo}>
              {ocupado
                ? <><Loader2 size={17} className="animate-spin" /> Registrando…</>
                : travadoPorIntervalo
                  ? <><Clock size={17} /> Aguarde {espera}s para abrir</>
                  : <><Send size={17} /> Abrir conversa no WhatsApp</>}
            </Botao>
            {travadoPorIntervalo && (
              <p className="mt-2 text-center text-xs leading-relaxed text-suave">
                O intervalo entre uma abordagem e outra vale também para o material. Emendar
                mensagens seguidas do mesmo número é o padrão que o WhatsApp derruba.
              </p>
            )}
          </div>
        </>
      )}

      {fase === 'aberta' && (
        <div className="space-y-4 border-t border-borda px-6 py-5">
          {/* A cidade fica AQUI, e não só na entrega. Ela costuma aparecer no
              meio da conversa ("sou de Ji-Paraná"), muito antes de se saber o
              desfecho — e antes ficava perdida sempre que a pessoa não
              autorizava, que é a maioria das conversas. */}
          <Selecao rotulo="Se ela disse de onde é, marque aqui" value={municipioId}
                   onChange={(e) => aoMudarMunicipio(e.target.value ? Number(e.target.value) : '')}>
            <option value="">Não informou</option>
            {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
          </Selecao>

          <div>
            <p className="mb-3.5 text-sm font-semibold">Depois de conversar, marque o resultado:</p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {RESULTADOS.map((r, i) => {
                const armado = r === 'pediu_saida' && confirmandoSaida;
                return (
                  <Botao key={r} variante={r === 'pediu_saida' ? 'perigo' : 'neutro'}
                         onClick={() => aoMarcar(r)} disabled={ocupado}
                         className="justify-between !rounded-2xl py-3">
                    <span>{armado ? 'Confirmar saída' : ROTULO_RESULTADO[r]}</span>
                    <kbd className="rounded-md border border-borda bg-fundo px-1.5 py-0.5 font-sans text-[10px] text-suave">
                      {i + 1}
                    </kbd>
                  </Botao>
                );
              })}
            </div>

            {confirmandoSaida && (
              <p className="mt-2.5 text-xs leading-relaxed text-perigo">
                Clique de novo para confirmar. &ldquo;Pediu saída&rdquo; bloqueia o número para
                sempre e apaga os dados em 48h — e desfazer depois depende do gestor.
              </p>
            )}
          </div>

          <label className="block">
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

          {/* ⚠️ O desfecho mais COMUM de uma abordagem não é nenhum dos cinco
              botões acima: é a pessoa não responder na hora. Esse caminho existia
              só como um link de 12px no rodapé do cartão, ao lado de cinco botões
              grandes — então o atendente com pressa marcava um resultado
              qualquer para poder seguir, e o relatório passava a medir uma
              conversa que não aconteceu. */}
          <div className="border-t border-borda pt-4">
            <Botao variante="neutro" tamanho="g" className="w-full" onClick={aoPular}
                   disabled={ocupado}>
              {ocupado
                ? <><Loader2 size={16} className="animate-spin" /> Soltando…</>
                : <><Clock size={16} /> Ainda não respondeu — buscar próximo</>}
            </Botao>
            <p className="mt-2 text-center text-xs leading-relaxed text-suave">
              A conversa fica aberta em <strong>Meus contatos</strong>. Quando ela responder, você
              marca o resultado por lá.
            </p>
          </div>
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

      {/* Antes de abrir a conversa, soltar o contato o devolve para a FILA —
          outra pessoa pode pegar. Depois de aberta é outra coisa, e por isso o
          botão grande lá em cima: ali a conversa já existe e ninguém mais pode
          reabordar quem já foi abordado. */}
      {fase === 'permissao' && (
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
  entregas, ocupado, espera, escolhido, aoPreparar,
}: {
  entregas: EntregaDoContato[]; ocupado: boolean; espera: number; escolhido: string | null;
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
          : espera > 0
            ? `Um de cada vez: o próximo material libera em ${espera}s. Emendar vários seguidos é o que derruba número.`
            : 'Mande um de cada vez e espere a resposta. Emendar vários materiais seguidos é o que derruba número.'}
      </p>

      <div className="space-y-2">
        {entregas.map((c) => {
          const enviado = c.material_enviado_em !== null;
          const semPeca = c.materiais === 0;
          const bloqueado = ocupado || semPeca || !c.ativo || espera > 0;
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
                {espera > 0
                  ? `aguarde ${espera}s`
                  : enviado ? 'Mandar de novo' : 'Preparar material'}
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

/* ── As listas que este atendente atende ─────────────────────────────────── */

/**
 * Duas formas de trabalhar, na mesma faixa.
 *
 * AUTOMÁTICO (o padrão, "Todas"): a fila mistura as listas do atendente na
 * ordem de sempre — quente antes de frio, mais antigo primeiro — e cada contato
 * chega com a etiqueta da lista de onde veio.
 *
 * MANUAL: ele escolhe uma lista e só recebe dela. É o que serve para "hoje de
 * manhã eu faço o bairro tal", sem depender de o gestor remontar a atribuição.
 *
 * A troca fica travada com um contato na mão de propósito: mudar a fila no meio
 * de um atendimento não muda o contato que já está na tela, e um botão que
 * parece não fazer nada é pior que um botão desabilitado com o motivo escrito.
 */
function FaixaDeListas({
  listas, escolhida, bloqueada, aoEscolher,
}: {
  listas: ListaDoAtendente[];
  escolhida: string | null;
  bloqueada: boolean;
  aoEscolher: (id: string | null) => void;
}) {
  // Sem lista nenhuma não há o que escolher — e o motivo `sem_lista` já explica
  // a situação com todas as letras no lugar do cartão de espera.
  if (listas.length === 0) return null;

  const total = listas.reduce((n, l) => n + l.na_fila, 0);
  const motivo = bloqueada ? 'Termine o contato atual para trocar de lista.' : undefined;

  return (
    <section aria-label="Suas listas" className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="mr-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
          Suas listas
        </p>

        <BotaoDeLista
          ativo={escolhida === null} bloqueada={bloqueada} titulo={motivo}
          contagem={total} aoClicar={() => aoEscolher(null)}
        >
          <Layers size={12} /> Todas
        </BotaoDeLista>

        {listas.map((l) => (
          <BotaoDeLista
            key={l.id} ativo={escolhida === l.id} bloqueada={bloqueada} titulo={motivo}
            contagem={l.na_fila} aoClicar={() => aoEscolher(l.id)}
          >
            <PontoLista id={l.id} />
            <span className="max-w-[12rem] truncate">{l.rotulo}</span>
          </BotaoDeLista>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-suave">
        {escolhida === null
          ? 'A fila mistura todas as suas listas, dos mais antigos para os mais novos. Cada contato chega com a etiqueta de onde veio.'
          : 'Você está atendendo só esta lista. Volte para “Todas” quando quiser a fila inteira.'}
      </p>
    </section>
  );
}

function BotaoDeLista({
  children, contagem, ativo, bloqueada, titulo, aoClicar,
}: {
  children: React.ReactNode;
  contagem: number;
  ativo: boolean;
  bloqueada: boolean;
  titulo?: string;
  aoClicar: () => void;
}) {
  return (
    <button
      type="button"
      onClick={aoClicar}
      disabled={bloqueada}
      title={titulo}
      aria-pressed={ativo}
      className={cx(
        'flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50',
        ativo
          ? 'border-acento/40 bg-acento/12 text-acento'
          : 'border-borda bg-superficie text-suave enabled:hover:border-borda-forte enabled:hover:text-texto',
      )}
    >
      {children}
      <span className="tabular-nums opacity-70">{contagem.toLocaleString('pt-BR')}</span>
    </button>
  );
}
