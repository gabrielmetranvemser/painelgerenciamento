'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import {
  AlertTriangle, Check, ChevronDown, CircleSlash, Clock, Copy, Flame, Layers, List, Loader2,
  MessageSquare, PackageOpen, Search, Send, Siren, Snowflake, SkipForward, Star, X,
} from 'lucide-react';
import {
  Aviso, Avatar, Botao, Cartao, EtiquetaLista, EtiquetaOrigem, Pilula, PontoLista, Selecao,
  Vidro, cx,
} from '@/components/ui';
import { guardarChip, useChipSalvo } from '@/components/chip-salvo';
import { guardarLista, useListaSalva } from '@/components/lista-salva';
import { ComoAgir } from '@/components/como-agir';
import { formatarExibicao } from '@/lib/telefone';
import { abrirNaAbaDoWhatsapp, temExtensao } from '@/lib/whatsapp-aba';
import {
  DICA_RESULTADO, PASSOS_DA_CONVERSA, RESULTADOS_COM_TEXTO, RESULTADOS_OUTROS,
  RESULTADOS_RAPIDOS, ROTULO_CARGO, ROTULO_RESULTADO, TEXTO_MOTIVO,
  type Chip, type ContatoDaFila, type EntregaDoContato, type EtapaMsg, type FilaStatus,
  type ListaDoAtendente, type Municipio, type PassoDaConversa, type Resultado,
} from '@/lib/tipos-banco';
import {
  carregarEntregas, carregarFilaDoAtendente, carregarMinhasListas, consultarFila,
  definirMunicipio, pegarEscolhido, pegarProximo, prepararMensagem, pularContato,
  pularIntervalo, registrarAbertura, registrarResultado, sinalizarChip,
  type ContatoNaFila, type MensagemPronta,
} from './acoes';

/**
 * 'abordagem' cobre os TRÊS passos que abrem a conversa — abertura, minha
 * escolha e permissão. Não são três fases porque a tela é a mesma: o que muda
 * é qual texto está no cartão e qual botão vem depois. Ver `PASSOS_DA_CONVERSA`.
 */
type Fase = 'ocioso' | 'abordagem' | 'aberta' | 'entrega' | 'seguimento';

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
  abertura: 'Passo 1 de 3 — só o oi, e espere responder',
  minha_escolha: 'Passo 2 de 3 — conte a sua escolha',
  permissao: 'Passo 3 de 3 — peça permissão para mandar o material',
  saida: 'Confirme que o contato saiu da lista',
  quer_ajudar: 'Resposta para quem quer ajudar',
  encaminhamento: 'Resposta para quem pediu algo que não podemos prometer',
};

/** Nome da janela do WhatsApp: reaproveita a mesma aba em vez de abrir 30. */
const JANELA_WA = 'whatsapp-atendimento';

/**
 * As etapas em que o intervalo vale — as mesmas de `etapa_de_abordagem()` no
 * banco. Hoje é só a ABERTURA: ela é a única mensagem que chega sem aviso, para
 * quem não espera. Tudo depois dela é conversa com quem já respondeu, e fazer o
 * atendente esperar dois minutos para continuar falando com a mesma pessoa é o
 * que faz ELE parecer robô.
 *
 * Isto aqui é espelho da trava, não a trava: quem decide é o servidor.
 */
const ETAPAS_DE_ABORDAGEM: EtapaMsg[] = ['abertura'];

/**
 * O próximo passo da abordagem para esta pessoa, ou `null` quando os três já
 * saíram e a conversa está aberta.
 *
 * ⚠️ Lê `contato.passos`, que vem do SERVIDOR. Não guarda estado próprio de
 * propósito: o mesmo contato pode voltar pela fila, ser escolhido a dedo ou ser
 * reaberto por "Meus contatos" dias depois, e em qualquer um desses caminhos a
 * tela nasce sem memória do que já foi mandado. Repetir uma mensagem que a
 * pessoa já recebeu é o erro mais caro que esta tela pode cometer.
 */
function proximoPasso(passos: readonly PassoDaConversa[]): PassoDaConversa | null {
  return PASSOS_DA_CONVERSA.find((e) => !passos.includes(e)) ?? null;
}

export function Atendimento({
  primeiroNome, chips, municipios, filaInicial, aguardandoInicial, listasIniciais,
  rotaMeusContatos, rotaScript,
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
  /** Endereço do roteiro completo, que abre em aba própria. */
  rotaScript: string;
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
  /**
   * O desfecho que está ARMADO, esperando o segundo clique.
   *
   * ⚠️ Antes era um booleano só para "Pediu saída". Passou a valer para TODOS,
   * a pedido de quem opera: com onze botões numa grade e atalho de teclado, o
   * clique errado é rotina — e um desfecho errado tira a pessoa da fila, ou a
   * põe de volta, sem ninguém perceber. Dois cliques em todos custa um clique a
   * mais por conversa; um "Autorizou" no lugar de "Número inválido" custa uma
   * pessoa recebendo material que ela não pediu.
   *
   * Mora AQUI, e não dentro de `Desfechos`, porque o atalho de teclado também
   * passa por ele — e é justamente o "2" apertado sem querer o caso que mais
   * dói.
   */
  const [confirmando, setConfirmando] = useState<Resultado | null>(null);
  /** A folha de escolher contato está aberta. */
  const [escolhendo, setEscolhendo] = useState(false);
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

  /**
   * Pula o intervalo — depois do segundo clique, e só uma vez.
   *
   * Quem conta quantas vezes já pulou é o SERVIDOR: o aviso que a tela mostra
   * sai de `fila.intervalos_pulados_hoje`, e a trava real está em
   * `registrar_abertura`. Contar aqui seria contar num lugar que se zera
   * recarregando a página.
   */
  function pularOIntervalo() {
    iniciar(async () => {
      const r = await pularIntervalo(chipId);
      if (!r.ok) {
        setErro(MOTIVO_ENVIO[r.motivo] ?? `Não consegui pular o intervalo (${r.motivo}).`);
        return;
      }
      setErro(null);
      await atualizarFila();
    });
  }

  /**
   * Vai direto para um passo da abordagem, escolhido pelo atendente.
   *
   * ⚠️ Existe porque a sequência é o CAMINHO COMUM, não uma regra. Quem já
   * conhece a pessoa não precisa mandar "oi" antes de contar a escolha; quem
   * pegou uma conversa no meio precisa ir para onde ela parou. Obrigar a passar
   * pelos três faria o atendente mandar mensagem que ele sabe que não faz
   * sentido — e o painel perde a confiança dele na primeira vez que isso
   * acontece.
   *
   * Não fura nada: `registrar_abertura` continua sendo quem decide, e reenviar
   * um passo já enviado é idempotente (não conta duas vezes no teto).
   */
  function escolherPasso(passo: PassoDaConversa) {
    if (!contato) return;
    iniciar(async () => {
      const m = await prepararMensagem(contato.id, chipId, passo);
      if (!m.ok) {
        setErro(MOTIVO_ENVIO[m.motivo] ?? `Não consegui montar a mensagem (${m.motivo}).`);
        return;
      }
      setErro(null);
      setMensagem(m);
      setFase('abordagem');
      setTimeout(() => botaoAbrir.current?.focus(), 60);
    });
  }

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

  /**
   * Monta o próximo passo da abordagem e coloca o cartão na tela.
   *
   * Existe como função porque três caminhos chegam ao mesmo lugar — buscar o
   * próximo, escolher da fila e seguir depois de um envio — e três cópias disto
   * sairiam de sincronia no primeiro ajuste da sequência.
   *
   * Quando não falta passo nenhum, a conversa já está aberta: a tela vai direto
   * para o desfecho, sem oferecer uma mensagem que a pessoa já recebeu.
   */
  async function abrirPassoDaConversa(
    alvo: ContatoDaFila,
    aoFalhar: (motivo: string) => void,
  ) {
    const passo = proximoPasso(alvo.passos);
    if (!passo) {
      setMensagem(null);
      setFase('aberta');
      return;
    }
    const m = await prepararMensagem(alvo.id, chipId, passo);
    if (!m.ok) { aoFalhar(m.motivo); return; }
    setMensagem(m);
    setFase('abordagem');
    setTimeout(() => botaoAbrir.current?.focus(), 60);
  }

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

      await abrirPassoDaConversa(r.contato, (msg) =>
        setErro(`Não consegui montar a mensagem (${msg}). Fale com o gestor.`));
    });
  }

  /**
   * Leva o endereço da conversa para o WhatsApp, na melhor via disponível.
   *
   * A extensão é tentada primeiro porque é a única que enxerga a aba que o
   * atendente abriu sozinho. Se ela não estiver instalada, ou recusar, cai no
   * `window.open` nomeado — que é o que sempre funcionou.
   */
  async function levarParaOWhatsapp(
    url: string,
    janela: Window | null,
    pelaExtensao: boolean,
  ) {
    if (pelaExtensao && (await abrirNaAbaDoWhatsapp(url))) return;
    if (janela && !janela.closed) { janela.location.href = url; return; }
    window.open(url, JANELA_WA);
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
    // Com a extensão instalada, quem acha a aba do WhatsApp é ela — inclusive a
    // que o atendente abriu por conta própria, que o `window.open` nomeado não
    // alcança. Sem extensão, o caminho de sempre. Ver `src/lib/whatsapp-aba.ts`.
    const pelaExtensao = temExtensao();
    const janela = pelaExtensao ? null : window.open('', JANELA_WA);
    setErro(null);
    const enviada = mensagem;
    iniciar(async () => {
      const r = await registrarAbertura(
        contato.id, chipId, enviada.etapa, enviada.variacaoId,
        enviada.candidato?.id ?? null, enviada.modeloLivreId,
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
      await levarParaOWhatsapp(enviada.urlWhatsApp, janela, pelaExtensao);
      seguirDepoisDoEnvio(enviada, r.fila);
    });
  }

  /**
   * Copia o texto em vez de abrir o WhatsApp.
   *
   * ⚠️ PASSA PELO MESMO `registrarAbertura`, e isso não é economia de código:
   * copiar é o passo anterior a enviar. Se copiar não registrasse, o teto do
   * dia, o intervalo entre abordagens e a trilha de auditoria deixariam de
   * enxergar a mensagem — e o atendente teria, sem querer, um caminho para
   * furar as três coisas. Mesma razão de `src/lib/bots.ts` existir.
   *
   * Serve para quem já está com a conversa aberta no WhatsApp Web: abrir de
   * novo recarrega a aba, e no meio de trinta conversas isso custa caro.
   *
   * A cópia acontece DEPOIS do `await`, e não junto do clique. No Chrome — que
   * é o navegador da operação, o mesmo da extensão — isso funciona; se o
   * navegador recusar, o `catch` avisa em vez de fingir que copiou, porque o
   * envio a essa altura JÁ está registrado.
   */
  function copiarConversa() {
    if (!contato || !mensagem) return;
    setErro(null); setAviso(null);
    const enviada = mensagem;
    iniciar(async () => {
      const r = await registrarAbertura(
        contato.id, chipId, enviada.etapa, enviada.variacaoId,
        enviada.candidato?.id ?? null, enviada.modeloLivreId,
      );
      if (!r.ok) {
        setErro(
          MOTIVO_ENVIO[r.motivo] ??
          `O sistema não registrou o envio: ${r.motivo}. Não envie nada — fale com o gestor.`,
        );
        await atualizarFila();
        return;
      }
      try {
        await navigator.clipboard.writeText(enviada.texto);
        setAviso('Texto copiado. Cole na conversa que já está aberta no WhatsApp.');
      } catch {
        setAviso(
          'O envio foi registrado, mas não consegui copiar sozinho. ' +
          'Selecione o texto acima e copie na mão.',
        );
      }
      seguirDepoisDoEnvio(enviada, r.fila);
    });
  }

  /**
   * O que acontece depois de o envio ser registrado — igual para quem abre o
   * WhatsApp e para quem copia o texto.
   *
   * Estava escrito dentro de `abrirConversa`; virou função quando o botão de
   * copiar entrou, porque duas cópias disto sairiam de sincronia no primeiro
   * ajuste de fase.
   */
  function seguirDepoisDoEnvio(enviada: MensagemPronta, filaNova: FilaStatus) {
    setFila(filaNova);
    setEspera(filaNova.segundos_espera);

    // Avança na sequência da abordagem. `contato.passos` vem do servidor e
    // ainda não sabe do envio que acabou de acontecer, então some a etapa
    // enviada aqui — senão a tela ofereceria o mesmo passo de novo.
    if ((PASSOS_DA_CONVERSA as readonly string[]).includes(enviada.etapa)) {
      const feitos = [...(contato?.passos ?? []), enviada.etapa as PassoDaConversa];
      setContato((c) => (c ? { ...c, passos: feitos } : c));

      const proximo = proximoPasso(feitos);
      if (!proximo) { setMensagem(null); setFase('aberta'); return; }

      iniciar(async () => {
        const m = await prepararMensagem(contato!.id, chipId, proximo);
        if (!m.ok) {
          // A conversa JÁ foi aberta; o que falhou foi o passo seguinte. Cair
          // para o desfecho é melhor que travar o atendente com a pessoa
          // esperando do outro lado.
          setErro(MOTIVO_ENVIO[m.motivo] ?? `Não consegui montar o passo seguinte (${m.motivo}).`);
          setMensagem(null);
          setFase('aberta');
          return;
        }
        setMensagem(m);
        setFase('abordagem');
        setTimeout(() => botaoAbrir.current?.focus(), 60);
      });
      return;
    }

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
  }

  /**
   * Marca o resultado. SEMPRE em dois tempos.
   *
   * O primeiro clique (ou a primeira tecla) só ARMA o botão; o segundo é que
   * grava. Clicar noutro desfecho antes disso desarma o primeiro e arma o
   * segundo — ninguém confirma sem querer o que não escolheu.
   *
   * "Pediu saída" já era assim desde a migration 340300, porque cria bloqueio
   * permanente e desfazer depende do gestor. Os outros dez ganharam a mesma
   * proteção depois dos testes com os atendentes: onze botões numa grade, com
   * atalho de teclado, no meio de trinta conversas por dia.
   */
  function marcar(resultado: Resultado) {
    // ⚠️ Antes exigia `fase === 'aberta'`, ou seja, os três passos completos.
    // Com quatro passos isso trancaria o caso mais comum de todos: a pessoa
    // responde "não quero" logo no "oi". O servidor já garante o que importa —
    // `registrar_resultado` recusa desfecho sem nenhuma mensagem enviada.
    if (!contato) return;
    if (fase !== 'aberta' && fase !== 'abordagem') return;
    if (fase === 'abordagem' && contato.passos.length === 0) return;
    if (RESULTADOS_COM_TEXTO.includes(resultado) && !encaminhamento.trim()) {
      setErro(resultado === 'encaminhado'
        ? 'Escreva em uma linha o que a pessoa pediu, para a equipe saber o que encaminhar.'
        : 'Escreva em uma linha o que aconteceu — senão "Outro" não diz nada a ninguém.');
      return;
    }
    if (confirmando !== resultado) {
      setConfirmando(resultado);
      setErro(null);
      return;
    }
    setConfirmando(null);
    setErro(null);
    iniciar(async () => {
      // O campo livre só acompanha "Encaminhar" e "Outro". Antes ia em todo
      // resultado: quem digitasse uma anotação e depois clicasse em "Pediu
      // saída" gravava texto livre na ficha de alguém que acabou de pedir para
      // sair — e o campo livre é o único lugar do sistema onde caberia, por
      // engano, uma anotação que não pode existir.
      const r = await registrarResultado(
        contato.id, resultado, municipioId || null,
        RESULTADOS_COM_TEXTO.includes(resultado) ? encaminhamento : null,
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

  /**
   * Abre um contato escolhido a dedo, em vez do próximo da fila.
   *
   * O corpo é o mesmo de `buscarProximo` depois da chamada — só muda quem
   * decide QUAL contato. As travas continuam todas no servidor.
   */
  function buscarEscolhido(contatoId: string) {
    setEscolhendo(false);
    iniciar(async () => {
      setErro(null);
      const r = await pegarEscolhido(contatoId, chipId);
      setFila(r.fila);
      setEspera(r.fila.segundos_espera);
      if (!r.ok) {
        setErro(r.motivo === 'contato_indisponivel'
          ? 'Esse contato não está mais disponível — outra pessoa pegou, ou ele saiu da sua fila.'
          : (TEXTO_MOTIVO[r.motivo] ?? `Não consegui abrir esse contato (${r.motivo}).`));
        return;
      }
      setContato(r.contato);
      setMunicipioId(r.contato.municipio_id ?? '');
      setEncaminhamento('');
      setEntregas([]);

      await abrirPassoDaConversa(r.contato, (msg) =>
        setErro(MOTIVO_ENVIO[msg] ?? `Não consegui montar a mensagem (${msg}). Fale com o gestor.`));
    });
  }

  function limparEBuscar() {
    setContato(null); setMensagem(null); setEntregas([]); setFase('ocioso');
    setConfirmando(null);
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
        // Só os cinco de sempre. Os desfechos que entraram depois ficam atrás
        // de "Outros desfechos" e sem atalho: número que já estava na memória
        // dos dedos não pode passar a fazer outra coisa.
        const i = Number(e.key) - 1;
        if (i >= 0 && i < RESULTADOS_RAPIDOS.length) {
          e.preventDefault();
          marcar(RESULTADOS_RAPIDOS[i]);
        }
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

        {fila?.teto_estourado && !fila.teto_bloqueia && (
          <AvisoDoTeto
            feitas={fila.enviados_hoje} teto={fila.teto_hoje} emRampa={fila.em_rampa}
          />
        )}

        {chip?.status === 'amarelo' && (
          <Aviso tom="alerta" icone={<Siren size={16} />}>
            Seu número está marcado como <strong>atenção</strong>. Vá mais devagar e avise o gestor.
          </Aviso>
        )}

        {travado && (
          <Travado
            fila={fila} espera={espera} ocupado={ocupado}
            listaEscolhida={lista?.rotulo ?? null}
            aoVerTodas={() => trocarLista(null)}
            aoPularIntervalo={pularOIntervalo}
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
            <div className="mt-7 flex flex-wrap justify-center gap-2.5">
              <Botao tamanho="g" onClick={buscarProximo} disabled={ocupado}>
                {ocupado
                  ? <><Loader2 size={17} className="animate-spin" /> Buscando…</>
                  : 'Buscar próximo contato'}
              </Botao>
              {/* ⚠️ "Próximo" continua sendo o caminho principal, e o botão
                  grande é ele: é a ordem da fila que mantém quente antes de
                  frio e mais antigo primeiro. Escolher existe para o caso
                  combinado ("falei que ligava hoje"), não para todo mundo
                  garimpar os fáceis. */}
              <Botao tamanho="g" variante="neutro" onClick={() => setEscolhendo(true)}
                     disabled={ocupado}>
                <List size={16} /> Escolher da fila
              </Botao>
            </div>
          </Cartao>
        )}

        {escolhendo && (
          <EscolherContato
            listaId={listaId}
            aoEscolher={buscarEscolhido}
            aoFechar={() => setEscolhendo(false)}
          />
        )}

        {contato && fase !== 'ocioso' && (
          <CartaoAtendimento
            contato={contato} mensagem={mensagem} fase={fase} ocupado={ocupado}
            entregas={entregas} refBotao={botaoAbrir} espera={espera}
            puloGuardado={fila?.pulo_guardado ?? false}
            confirmando={confirmando}
            municipios={municipios} municipioId={municipioId}
            encaminhamento={encaminhamento}
            aoMudarMunicipio={(id) => {
              setMunicipioId(id);
              if (id) iniciar(async () => { await definirMunicipio(contato.id, id); });
            }}
            aoMudarEncaminhamento={setEncaminhamento}
            aoAbrir={abrirConversa} aoCopiar={copiarConversa}
            aoMarcar={marcar} aoProximo={limparEBuscar}
            aoPular={pularEBuscar} aoPrepararMaterial={prepararMaterial}
            aoEscolherPasso={escolherPasso}
          />
        )}
      </div>

      <aside className="space-y-5 lg:sticky lg:top-20 lg:self-start">
        <Regras teto={fila?.teto_hoje ?? 30} inicio={fila?.hora_inicio ?? 9} fim={fila?.hora_fim ?? 20}
                emRampa={fila?.em_rampa ?? false} diaRampa={fila?.dia_rampa ?? 1} />
        <ComoAgir rotaScript={rotaScript} />
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
  modelo_obrigatorio: 'Escolha qual mensagem mandar.',
  sem_chapa:
    'Você ainda não tem candidato atribuído, então a primeira mensagem sairia sem dizer de quem ' +
    'é o material — e a pessoa autorizaria sem saber o que está autorizando. Fale com o gestor ' +
    'antes de abrir qualquer conversa.',
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
            <p className={cx('text-xs', fila?.teto_estourado ? 'text-perigo' : 'text-suave')}>
              {!fila
                ? '—'
                : fila.teto_estourado
                  // Dizer "restam 0" e continuar deixando trabalhar seria a tela
                  // discordando de si mesma.
                  ? `${fila.enviados_hoje} conversas hoje — ${teto} era o combinado`
                  : `${fila.restante_hoje} de ${teto} conversas restantes hoje`}
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

/**
 * "Você passou do combinado" — a linha fica, o parágrafo encolhe.
 *
 * ⚠️ Desde que o teto avisa em vez de travar, este aviso é a única coisa entre
 * o atendente e um número derrubado. Por isso ele NÃO se fecha e NÃO some: o
 * título continua na tela o resto do dia, em vermelho, com a conta na frente.
 *
 * O que encolhe é a explicação. Ela ocupava metade da coluna do atendimento e é
 * a mesma em toda conversa — quem já leu uma vez lê o título e sabe do que se
 * trata. Deixá-la aberta para sempre não avisa mais ninguém: vira paisagem, que
 * é a forma mais rápida de um aviso parar de funcionar.
 *
 * Abre na PRIMEIRA vez do dia, e só encolhe depois que a pessoa fecha. É a
 * ordem certa: ninguém decide não ler o que ainda não viu. A memória é do dia,
 * porque amanhã o número acorda inteiro e a conversa recomeça.
 */
function AvisoDoTeto({
  feitas, teto, emRampa,
}: {
  feitas: number; teto: number; emRampa: boolean;
}) {
  const chave = `painel:teto-encolhido:${new Date().toISOString().slice(0, 10)}`;

  // Falhar aqui (anônima, dados limpos) abre o aviso, que é o lado seguro.
  const [aberto, setAberto] = useState(() => {
    try { return localStorage.getItem(chave) !== '1'; } catch { return true; }
  });

  function alternar() {
    const proximo = !aberto;
    setAberto(proximo);
    try {
      if (proximo) localStorage.removeItem(chave);
      else localStorage.setItem(chave, '1');
    } catch { /* sem memória, reabre amanhã do mesmo jeito */ }
  }

  return (
    <Aviso tom="erro" icone={<Siren size={16} />}>
      <button
        type="button"
        onClick={alternar}
        aria-expanded={aberto}
        className="flex w-full cursor-pointer items-start gap-2 text-left"
      >
        <span className="mr-auto font-medium">
          Você já fez {feitas} conversas hoje — o combinado eram {teto}.
        </span>
        <ChevronDown
          size={15}
          className={cx('mt-0.5 shrink-0 transition-transform duration-200', aberto && 'rotate-180')}
        />
      </button>

      {aberto && (
        <p className="mt-1.5 text-sm leading-relaxed">
          Daqui pra frente é por sua conta. Número que fala com muita gente nova no mesmo dia é o
          padrão que o WhatsApp derruba{emRampa && ', e o seu ainda está aquecendo'} — e quando
          cai, as conversas abertas caem junto e não voltam. O melhor a fazer é parar por aqui e
          continuar amanhã.
        </p>
      )}
    </Aviso>
  );
}

function Travado({
  fila, espera, ocupado, listaEscolhida, aoVerTodas, aoPularIntervalo,
}: {
  fila: FilaStatus;
  espera: number;
  ocupado: boolean;
  /** O nome da lista sendo trabalhada, quando o atendente escolheu uma só. */
  listaEscolhida: string | null;
  aoVerTodas: () => void;
  aoPularIntervalo: () => void;
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

          <PularIntervalo
            pulosHoje={fila.intervalos_pulados_hoje}
            ocupado={ocupado}
            aoPular={aoPularIntervalo}
          />
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
            <>
              <p className="mt-2 text-sm text-suave">
                Foram {fila.enviados_hoje} conversas hoje. Amanhã tem mais.
              </p>
              {/* ⚠️ Sem esta frase, o atendente lê "acabou" onde o gestor
                  prometeu 30 e conclui que o painel está errado — foi o que
                  aconteceu em 28/08. O limite de hoje é MENOR de propósito, e
                  quem precisa saber disso é quem está com o número na mão. */}
              {fila.em_rampa && fila.teto_hoje < fila.teto_gestor && (
                <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-suave">
                  Seu número ainda está aquecendo: hoje ele para em {fila.teto_hoje}, e não nas{' '}
                  {fila.teto_gestor} do resto da operação. É o dia {fila.dia_rampa} de uso — o
                  limite sobe sozinho a cada dia trabalhado. Número novo que fala com muita gente
                  de uma vez é bloqueado pelo WhatsApp.
                </p>
              )}
            </>
          )}
          {fila.motivo === 'sem_lista' && (
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-suave">
              A base tem contatos — eles é que estão em listas que ainda não são suas. Quem
              escolhe é o gestor: peça a ele para marcar suas listas.
            </p>
          )}
          {/* Não é fila vazia nem falta de trabalho: é configuração faltando.
              Sem candidato, a primeira mensagem sairia dizendo "tô ajudando
              nessa eleição" e mais nada — foi o que aconteceu em 27/08 com
              onze pessoas, e o material delas ficou travado depois. */}
          {fila.motivo === 'sem_candidato' && (
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-suave">
              Sua primeira mensagem precisa dizer de quem é o material. Sem candidato atribuído
              ela sairia sem nome nenhum, e quem respondesse estaria autorizando no escuro.
              Peça ao gestor para montar sua chapa — leva um minuto.
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

/**
 * O aviso de pular o intervalo, que endurece a cada repetição.
 *
 * ⚠️ DOIS CLIQUES, sempre. O primeiro só abre o aviso; o segundo é que age.
 * Não é para dificultar: é para o atendente LER antes de decidir. Um botão de
 * um clique no meio da tela de espera seria clicado por impulso, que é
 * exatamente o oposto do que "assumir o risco" quer dizer.
 *
 * O texto muda conforme quantas vezes AQUELE NÚMERO já pulou hoje, e o número
 * vem do servidor — contar aqui seria contar num lugar que se zera recarregando
 * a página. Do terceiro em diante o gestor também recebe alerta.
 *
 * A escala existe porque um pulo é acidente e cinco é hábito, e o mesmo texto
 * nas duas situações vira ruído: quem lê "tem certeza?" pela quinta vez não lê
 * mais nada.
 */
const AVISO_PULO = [
  {
    titulo: 'Tem certeza?',
    texto:
      'Pular o intervalo pode fazer o WhatsApp bloquear o seu número. Ele é o espaçamento que ' +
      'impede o mesmo número de parecer disparo.',
    botao: 'Pular mesmo assim',
  },
  {
    titulo: 'Você já fez isso antes hoje',
    texto:
      'É arriscado. Cada vez que você emenda uma abordagem na outra, seu número fica mais ' +
      'parecido com um robô aos olhos do WhatsApp.',
    botao: 'Pular mesmo assim',
  },
  {
    titulo: 'Essa é a terceira vez hoje',
    texto:
      'É melhor tomar cuidado. Números que pulam o intervalo com frequência são os que caem — e ' +
      'quando um número cai, as conversas abertas dele caem junto e não voltam. O gestor vai ver ' +
      'este aviso.',
    botao: 'Pular mesmo assim',
  },
] as const;

function PularIntervalo({
  pulosHoje, ocupado, aoPular,
}: {
  pulosHoje: number;
  ocupado: boolean;
  aoPular: () => void;
}) {
  const [armado, setArmado] = useState(false);

  // Da quarta vez em diante o texto para de aumentar e passa a nomear a
  // escolha. Não há aviso mais forte que fazer a pessoa dizer o que está
  // fazendo.
  const passouDoLimite = pulosHoje >= AVISO_PULO.length;
  const aviso = passouDoLimite
    ? {
        titulo: `Você já pulou o intervalo ${pulosHoje} vezes hoje`,
        texto:
          'Quando o número cai, as conversas abertas caem junto e não voltam — e a pessoa do ' +
          'outro lado fica esperando uma resposta que não chega. O gestor está vendo isso.',
        botao: 'Assumo o risco de bloquear o número',
      }
    : AVISO_PULO[pulosHoje];

  if (!armado) {
    return (
      <button
        type="button"
        onClick={() => setArmado(true)}
        disabled={ocupado}
        className="mt-6 text-xs text-suave underline underline-offset-4 transition-colors hover:text-texto disabled:opacity-45"
      >
        Pular intervalo
      </button>
    );
  }

  return (
    <div className="mx-auto mt-6 max-w-sm rounded-2xl border border-perigo/35 bg-perigo/[0.07] p-4 text-left">
      <p className="flex items-center gap-2 text-sm font-semibold text-perigo">
        <AlertTriangle size={15} /> {aviso.titulo}
      </p>
      <p className="mt-1.5 text-xs leading-relaxed text-suave">{aviso.texto}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Botao variante="perigo" tamanho="p" disabled={ocupado}
               onClick={() => { setArmado(false); aoPular(); }}>
          {ocupado ? 'Liberando…' : aviso.botao}
        </Botao>
        <Botao variante="fantasma" tamanho="p" onClick={() => setArmado(false)}>
          Esperar
        </Botao>
      </div>
    </div>
  );
}

/* ── Cartão do atendimento ───────────────────────────────────────────────── */

/**
 * Trocar o passo da conversa à mão.
 *
 * ⚠️ A sequência abertura → escolha → permissão é o CAMINHO COMUM, não uma
 * regra. Quem já conhece a pessoa não precisa mandar "oi" antes de contar a
 * escolha; quem pegou uma conversa no meio precisa ir para onde ela parou.
 * Obrigar a passar pelos três faria o atendente mandar mensagem que ele sabe
 * que não faz sentido — e o painel perde a confiança dele na primeira vez que
 * isso acontece.
 *
 * Fica ENCOLHIDO por padrão, atrás de "pular etapa". Aberto o tempo todo, ele
 * concorreria com o texto da mensagem, que é o que a pessoa veio ler; e a
 * maioria das conversas segue a sequência sem ninguém tocar aqui.
 *
 * Os passos já enviados aparecem com ✓ e continuam clicáveis: reenviar é
 * idempotente no servidor (não conta duas vezes no teto), e às vezes é
 * exatamente o que se quer — a pessoa apagou, não recebeu, pediu de novo.
 */
const ROTULO_PASSO_CURTO: Record<PassoDaConversa, string> = {
  abertura: '1. Abertura',
  minha_escolha: '2. Minha escolha',
  permissao: '3. Permissão',
};

function EscolherPasso({
  atual, feitos, ocupado, aoEscolher,
}: {
  atual: PassoDaConversa;
  feitos: readonly PassoDaConversa[];
  ocupado: boolean;
  aoEscolher: (passo: PassoDaConversa) => void;
}) {
  const [aberto, setAberto] = useState(false);

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button
        type="button"
        onClick={() => setAberto((v) => !v)}
        aria-expanded={aberto}
        className="flex items-center gap-1 text-[11px] font-medium text-suave transition-colors hover:text-texto"
      >
        <ChevronDown
          size={13}
          className={cx('transition-transform duration-200', aberto ? 'rotate-180' : '-rotate-90')}
        />
        pular etapa
      </button>

      {aberto && (
        <div className="flex flex-wrap items-center gap-1.5">
          {PASSOS_DA_CONVERSA.map((p) => {
            const eAtual = p === atual;
            const jaFoi = feitos.includes(p);
            return (
              <button
                key={p}
                type="button"
                disabled={ocupado || eAtual}
                onClick={() => { setAberto(false); aoEscolher(p); }}
                title={jaFoi ? 'Já enviada para esta pessoa — mandar de novo não conta duas vezes' : undefined}
                className={cx(
                  'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] transition-colors',
                  eAtual
                    ? 'border-acento/50 bg-acento/12 text-acento'
                    : 'border-borda text-suave hover:border-borda-forte hover:text-texto',
                  ocupado && !eAtual && 'opacity-45',
                )}
              >
                {jaFoi && <Check size={11} />}
                {ROTULO_PASSO_CURTO[p]}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function CartaoAtendimento({
  contato, mensagem, fase, ocupado, entregas, refBotao, municipios, municipioId, encaminhamento,
  espera, puloGuardado, confirmando, aoMudarMunicipio, aoMudarEncaminhamento, aoAbrir, aoCopiar,
  aoMarcar, aoProximo, aoPular, aoPrepararMaterial, aoEscolherPasso,
}: {
  contato: ContatoDaFila; mensagem: MensagemPronta | null; fase: Fase; ocupado: boolean;
  entregas: EntregaDoContato[];
  /** Segundos que faltam do intervalo. Trava os botões de abordagem. */
  espera: number;
  /** O atendente comprou um pulo e ele ainda não foi gasto. */
  puloGuardado: boolean;
  /** O desfecho armado, esperando o segundo clique. `null` = nenhum. */
  confirmando: Resultado | null;
  refBotao: React.RefObject<HTMLButtonElement | null>;
  municipios: Municipio[]; municipioId: number | ''; encaminhamento: string;
  aoMudarMunicipio: (id: number | '') => void;
  aoMudarEncaminhamento: (v: string) => void;
  aoAbrir: () => void; aoCopiar: () => void;
  aoMarcar: (r: Resultado) => void; aoProximo: () => void;
  aoPular: () => void; aoPrepararMaterial: (candidatoId: string) => void;
  aoEscolherPasso: (passo: PassoDaConversa) => void;
}) {
  /**
   * ⚠️ Nome COMPLETO no cartão, e não o primeiro.
   *
   * Quem lê aqui está prestes a falar com esta pessoa e precisa saber com QUEM
   * — "Espetinho" não distingue o Delegado do Esmerindo, e a lista importada
   * tem cinco deles. O primeiro nome continua indo para a MENSAGEM, por
   * `{{primeiro_nome}}`, que é onde ele serve.
   */
  const nome = contato.nome?.trim() || contato.primeiro_nome || 'Sem nome';
  const titulo = mensagem?.candidato
    ? `Material de ${mensagem.candidato.nome}`
    : (mensagem ? TITULO_ETAPA[mensagem.etapa] ?? 'Mensagem' : '');

  /**
   * O servidor recusa abordagem dentro do intervalo, e a tela desabilita antes
   * para o atendente não clicar num botão que só devolve erro.
   *
   * ⚠️ `puloGuardado` PRECISA entrar na conta. Sem ele, o atendente clicava em
   * "Pular intervalo", a tela de espera sumia — e o botão de abrir continuava
   * dizendo "Aguarde 93s". O pulo não zera o relógio de propósito (o intervalo
   * segue correndo, e o servidor mostra quanto falta); o que ele faz é liberar
   * UMA abordagem. Quem não soubesse disso concluiria que o botão não funciona.
   */
  const noIntervalo = espera > 0 && !puloGuardado;
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
        <Entrega entregas={entregas} ocupado={ocupado}
                 escolhido={mensagem?.candidato?.id ?? null}
                 aoPreparar={aoPrepararMaterial} />
      )}

      {mensagem && (
        <>
          <div className="px-6 py-5">
            <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
                <MessageSquare size={12} />
                {titulo}
              </p>
              {/* Só na abordagem: no material quem escolhe é o candidato, logo
                  acima, e uma segunda lista de escolha ao lado confundiria as
                  duas. */}
              {mensagem && (PASSOS_DA_CONVERSA as readonly string[]).includes(mensagem.etapa) && (
                <EscolherPasso
                  atual={mensagem.etapa as PassoDaConversa}
                  feitos={contato.passos}
                  ocupado={ocupado}
                  aoEscolher={aoEscolherPasso}
                />
              )}
            </div>
            <div className="rounded-2xl rounded-tl-md border border-borda bg-superficie-alta p-5 text-[15px] leading-[1.7] whitespace-pre-wrap">
              {mensagem.texto}
            </div>
            <p className="mt-2.5 text-xs text-suave">
              O texto abre já preenchido no WhatsApp. Ajuste ali se quiser antes de enviar.
            </p>
          </div>

          <div className="border-t border-borda px-6 py-5">
            <div className="flex flex-wrap gap-2.5">
              <Botao ref={refBotao} tamanho="g" className="min-w-[13rem] flex-1" onClick={aoAbrir}
                     disabled={ocupado || travadoPorIntervalo}>
                {ocupado
                  ? <><Loader2 size={17} className="animate-spin" /> Registrando…</>
                  : travadoPorIntervalo
                    ? <><Clock size={17} /> Aguarde {espera}s para abrir</>
                    : <><Send size={17} /> Abrir conversa no WhatsApp</>}
              </Botao>
              {/* Copiar registra o envio igual a abrir — não é atalho que pula
                  a auditoria. Existe para quem já está com a conversa aberta e
                  não quer que a aba do WhatsApp recarregue. */}
              <Botao tamanho="g" variante="neutro" onClick={aoCopiar}
                     disabled={ocupado || travadoPorIntervalo}
                     title="Copia o texto e registra o envio, sem recarregar o WhatsApp Web">
                <Copy size={16} /> Copiar texto
              </Botao>
            </div>
            <p className="mt-2 text-center text-xs leading-relaxed text-suave">
              Os dois registram o envio. Use <strong className="text-texto">Copiar</strong> quando a
              conversa já estiver aberta do lado.
            </p>
            {/* ⚠️ Este texto dizia que o intervalo "vale também para o
                material". Deixou de valer quando a conversa virou quatro
                passos: hoje só a ABERTURA espera, porque é a única mensagem que
                chega a quem não está esperando. Aviso que descreve uma regra que
                não existe mais é pior que aviso nenhum — ensina errado. */}
            {travadoPorIntervalo && (
              <p className="mt-2 text-center text-xs leading-relaxed text-suave">
                O intervalo vale para a primeira mensagem de cada pessoa: é ela que chega sem
                aviso, e é o padrão que o WhatsApp derruba. Continuar uma conversa já aberta não
                espera.
              </p>
            )}
          </div>
        </>
      )}

      {/* ⚠️ Os desfechos aparecem assim que a PRIMEIRA mensagem sai, e não só
          no fim dos três passos. O "não quero" mais comum chega logo depois do
          "oi": travar o desfecho até a permissão obrigaria o atendente a mandar
          mais duas mensagens para quem acabou de dizer que não quer — que é
          exatamente o que a lei chama de insistência. */}
      {(fase === 'aberta' || (fase === 'abordagem' && contato.passos.length > 0)) && (
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

          <Desfechos
            ocupado={ocupado} confirmando={confirmando}
            texto={encaminhamento}
            aoMarcar={aoMarcar} aoMudarTexto={aoMudarEncaminhamento}
          />

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
      {/* Devolver à fila só faz sentido ENQUANTO nada saiu. Depois da primeira
          mensagem a pessoa já foi abordada, e o caminho certo é o botão grande
          acima — que deixa a conversa aberta em "Meus contatos" em vez de
          oferecê-la a outro atendente, com outro número. O servidor faz essa
          distinção sozinho (`pular_contato`); a tela só não pode prometer o
          que ele não vai fazer. */}
      {fase === 'abordagem' && contato.passos.length === 0 && (
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

/* ── Escolher de quem falar ──────────────────────────────────────────────── */

/**
 * A folha que lista a fila para o atendente escolher a dedo.
 *
 * ⚠️ NÃO MOSTRA TELEFONE, e isso é de propósito: é uma lista de gente que
 * ninguém abordou ainda, e mandar o número de cada um para o navegador seria
 * exportar pedaço da base a cada abertura de tela. O número chega quando o
 * contato é pego — que é o momento em que ele passa a ser daquela pessoa.
 *
 * A busca é por NOME, e só. Procurar por telefone aqui transformaria a tela num
 * consultador de números; isso existe em outro lugar, com trava própria e
 * devolvendo o mínimo (ver `consultarTelefone`).
 */
function EscolherContato({
  listaId, aoEscolher, aoFechar,
}: {
  listaId: string | null;
  aoEscolher: (contatoId: string) => void;
  aoFechar: () => void;
}) {
  const [linhas, setLinhas] = useState<ContatoNaFila[] | null>(null);
  const [busca, setBusca] = useState('');
  const [carregando, setCarregando] = useState(true);
  const [erro, setErro] = useState<string | null>(null);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  // Espera a digitação parar: sem isso é uma ida ao servidor por tecla.
  useEffect(() => {
    let cancelado = false;
    const t = setTimeout(async () => {
      // `setCarregando` fica DENTRO do tempo, e não no corpo do efeito: chamar
      // setState de forma síncrona na abertura do efeito dispara renderização
      // em cascata.
      setCarregando(true);
      const r = await carregarFilaDoAtendente(listaId, busca);
      if (cancelado) return;
      // ⚠️ O erro precisa APARECER. Antes esta chamada podia rejeitar, e a
      // folha ficava em "carregando…" para sempre — o defeito parecia lentidão
      // da base, e não um erro.
      if (r.ok) { setLinhas(r.linhas); setErro(null); }
      else { setErro(r.erro); setLinhas([]); }
      setCarregando(false);
    }, busca ? 350 : 0);
    return () => { cancelado = true; clearTimeout(t); };
  }, [listaId, busca]);

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button type="button" aria-label="Fechar" onClick={aoFechar}
              className="absolute inset-0 bg-fundo/70 backdrop-blur-sm" />

      <div role="dialog" aria-modal="true" aria-label="Escolher contato"
           className={cx(
             'relative flex max-h-[92vh] w-full flex-col border border-borda bg-superficie',
             'rounded-t-3xl shadow-[var(--sombra-alta)] sm:max-w-lg sm:rounded-3xl',
           )}>
        <div className="flex items-start gap-3 p-5 pb-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold tracking-tight">Escolher contato</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-suave">
              Quem está esperando na sua fila. O de sempre é o botão &ldquo;Buscar próximo&rdquo;
              — esta lista serve para quando você combinou de falar com alguém.
            </p>
          </div>
          <button type="button" onClick={aoFechar} aria-label="Fechar"
                  className="grid size-8 shrink-0 place-items-center rounded-full text-suave hover:bg-superficie-alta hover:text-texto">
            <X size={16} />
          </button>
        </div>

        <label className="relative block px-5 pb-3">
          <Search size={15} className="pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 text-tenue" />
          <input
            autoFocus value={busca} onChange={(e) => setBusca(e.target.value)}
            placeholder="Buscar pelo nome" aria-label="Buscar pelo nome"
            className="w-full rounded-2xl border border-borda bg-superficie-alta py-2.5 pl-11 pr-4 text-sm placeholder:text-tenue"
          />
        </label>

        <div className="min-h-0 flex-1 overflow-y-auto border-t border-borda">
          {erro ? (
            <div className="p-5">
              <Aviso tom="erro" icone={<AlertTriangle size={16} />}>
                <strong>Não consegui carregar sua fila.</strong> Feche e use o botão
                &ldquo;Buscar próximo contato&rdquo;, que segue funcionando — e avise o gestor.
                <span className="mt-1.5 block text-xs opacity-80">{erro}</span>
              </Aviso>
            </div>
          ) : carregando && linhas === null ? (
            <p className="flex items-center justify-center gap-2 p-8 text-sm text-suave">
              <Loader2 size={15} className="animate-spin" /> carregando…
            </p>
          ) : (linhas ?? []).length === 0 ? (
            <p className="p-8 text-center text-sm leading-relaxed text-suave">
              {busca
                ? 'Ninguém com esse nome na sua fila.'
                : 'Sua fila está vazia agora.'}
            </p>
          ) : (
            <ul className="divide-y divide-borda">
              {(linhas ?? []).map((c) => (
                <li key={c.id}>
                  <button type="button" onClick={() => aoEscolher(c.id)}
                          className="flex w-full flex-wrap items-center gap-3 px-5 py-3.5 text-left transition-colors hover:bg-superficie-alta">
                    <Avatar nome={c.nome} tamanho="m" />
                    <div className="mr-auto min-w-0">
                      <p className="truncate text-sm font-semibold">{c.nome ?? 'Sem nome'}</p>
                      <p className="truncate text-xs text-suave">
                        {c.telefone_e164 ? formatarExibicao(c.telefone_e164) : '—'}
                        {c.municipio && ` · ${c.municipio}`}
                        {c.lista && ` · ${c.lista}`}
                      </p>
                    </div>
                    {/* Reagendado por ele mesmo: é a agenda dele, e é o motivo
                        mais comum de abrir esta tela. Vem em primeiro na
                        ordenação e marcado aqui. */}
                    {c.reagendado && <Pilula cor="alerta"><Clock size={11} /> falar hoje</Pilula>}
                    <EtiquetaOrigem origem={c.origem} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <p className="border-t border-borda px-5 py-3 text-xs leading-relaxed text-suave">
          Mostra os 40 primeiros da sua fila. Se não achar quem procura, use a busca pelo nome.
        </p>
      </div>
    </div>
  );
}

/* ── Os desfechos de uma conversa ────────────────────────────────────────── */

/**
 * Onze desfechos, cinco à mostra.
 *
 * ⚠️ ERAM CINCO, e vieram a onze pelos testes com os atendentes: o que
 * acontecia na conversa não cabia nos cinco, e quem não achava onde encaixar
 * marcava qualquer coisa para poder seguir. Um relatório que mede "número
 * inválido" onde houve "não é a pessoa" é pior que um relatório com uma coluna
 * a menos, porque parece certo.
 *
 * Mas onze botões numa grade é o mesmo que nenhum: o atendente com a conversa
 * aberta lê os três primeiros e clica. Então os cinco que decidem o rumo do
 * contato ficam à mão, com o atalho de teclado que já estava na memória dos
 * dedos, e o resto abre num clique.
 *
 * A microdescrição embaixo de cada um é o que impede o encaixe errado. É a
 * mesma ideia de `DICA_MOTIVO` na tela de suporte.
 */
function Desfechos({
  ocupado, confirmando, texto, aoMarcar, aoMudarTexto,
}: {
  ocupado: boolean;
  /** O desfecho armado, esperando o segundo clique. */
  confirmando: Resultado | null;
  texto: string;
  aoMarcar: (r: Resultado) => void;
  aoMudarTexto: (v: string) => void;
}) {
  const [abertos, setAbertos] = useState(false);
  const campo = useRef<HTMLInputElement>(null);
  const [faltaTexto, setFaltaTexto] = useState<Resultado | null>(null);

  /**
   * Os dois desfechos que exigem uma linha escrita não podem ser um clique que
   * devolve erro: quem clicou já decidiu, e a mensagem vermelha aparece longe
   * do campo. Aqui o clique leva o cursor para o campo e explica o que falta.
   */
  function clicar(r: Resultado) {
    if (RESULTADOS_COM_TEXTO.includes(r) && !texto.trim()) {
      setFaltaTexto(r);
      campo.current?.focus();
      return;
    }
    setFaltaTexto(null);
    aoMarcar(r);
  }

  return (
    <div className="space-y-4">
      <div>
        <p className="mb-3.5 text-sm font-semibold">Depois de conversar, marque o resultado:</p>

        <div className="grid gap-2.5 sm:grid-cols-2">
          {RESULTADOS_RAPIDOS.map((r, i) => (
            <BotaoDesfecho
              key={r} resultado={r} atalho={i + 1} ocupado={ocupado}
              armado={confirmando === r}
              aoClicar={() => clicar(r)}
            />
          ))}
        </div>

        {/* A frase muda com o peso do desfecho. "Pediu saída" tem consequência
            que não se desfaz sozinha; o resto se corrige no perfil do contato,
            e dizer o contrário faria o atendente parar de ler o aviso que
            importa. */}
        {confirmando && (
          <p className="mt-2.5 text-xs leading-relaxed text-perigo">
            {confirmando === 'pediu_saida'
              ? 'Clique de novo para confirmar. “Pediu saída” bloqueia o número para sempre e apaga os dados em 48h — e desfazer depois depende do gestor.'
              : `Clique de novo para confirmar “${ROTULO_RESULTADO[confirmando]}”. Se errou, é só clicar noutro desfecho.`}
          </p>
        )}

        <button
          type="button" onClick={() => setAbertos((v) => !v)}
          aria-expanded={abertos}
          className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-acento"
        >
          <ChevronDown size={14} className={cx('transition-transform', abertos && 'rotate-180')} />
          {abertos ? 'Menos desfechos' : 'Outros desfechos'}
        </button>

        {abertos && (
          <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
            {RESULTADOS_OUTROS.map((r) => (
              <BotaoDesfecho
                key={r} resultado={r} ocupado={ocupado}
                armado={confirmando === r}
                aoClicar={() => clicar(r)}
              />
            ))}
          </div>
        )}
      </div>

      <label className="block">
        <span className="text-xs leading-relaxed text-suave">
          Para <strong className="text-texto">Encaminhar</strong> ou{' '}
          <strong className="text-texto">Outro</strong>, escreva em uma linha o que aconteceu.
          {' '}Não escreva em quem a pessoa vota — isso não pode ser registrado.
        </span>
        <input
          ref={campo}
          value={texto}
          onChange={(e) => { aoMudarTexto(e.target.value); if (e.target.value.trim()) setFaltaTexto(null); }}
          maxLength={280} placeholder="ex.: perguntou sobre vaga de emprego"
          className={cx(
            'mt-2 w-full rounded-2xl border bg-superficie-alta px-4 py-2.5 text-sm placeholder:text-tenue',
            faltaTexto ? 'border-perigo' : 'border-borda',
          )}
        />
        {faltaTexto && (
          <span className="mt-1.5 block text-xs text-perigo">
            {faltaTexto === 'encaminhado'
              ? 'Escreva o que a pessoa pediu, para a equipe saber o que encaminhar.'
              : 'Escreva o que aconteceu — senão “Outro” não diz nada a ninguém.'}
          </span>
        )}
      </label>
    </div>
  );
}

/**
 * Um desfecho, em dois tempos.
 *
 * ⚠️ ARMADO, o botão muda de CARA — não só de texto. Um "Confirmar" discreto no
 * meio de onze botões iguais é lido como mais um botão, e o segundo clique sai
 * no automático, que é exatamente o engano que os dois tempos existem para
 * evitar. Armado ele fica cheio, vermelho e com o dedo apontando o que vai
 * acontecer.
 *
 * O atalho de teclado some enquanto está armado: a tecla continua funcionando,
 * mas mostrar "2" ao lado de "Confirmar" convida a apertar de novo sem ler.
 */
function BotaoDesfecho({
  resultado, atalho, ocupado, armado, aoClicar,
}: {
  resultado: Resultado;
  atalho?: number;
  ocupado: boolean;
  armado: boolean;
  aoClicar: () => void;
}) {
  const perigoso = resultado === 'pediu_saida';
  return (
    <button
      type="button" onClick={aoClicar} disabled={ocupado}
      className={cx(
        'rounded-2xl border p-3.5 text-left transition-colors disabled:opacity-45',
        armado
          ? 'border-perigo bg-perigo/15'
          : perigoso
            ? 'border-perigo/40 hover:border-perigo hover:bg-perigo/10'
            : 'border-borda hover:border-borda-forte hover:bg-superficie-alta',
      )}
    >
      <span className="flex items-center gap-2">
        <span className={cx(
          'mr-auto text-sm font-semibold',
          (perigoso || armado) && 'text-perigo',
        )}>
          {armado ? `Confirmar: ${ROTULO_RESULTADO[resultado]}` : ROTULO_RESULTADO[resultado]}
        </span>
        {atalho !== undefined && !armado && (
          <kbd className="shrink-0 rounded-md border border-borda bg-fundo px-1.5 py-0.5 font-sans text-[10px] text-suave">
            {atalho}
          </kbd>
        )}
        {armado && <Check size={15} className="shrink-0 text-perigo" />}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-suave">
        {armado ? 'Clique de novo para gravar.' : DICA_RESULTADO[resultado]}
      </span>
    </button>
  );
}

/* ── Entrega do material, um candidato por vez ───────────────────────────── */

/**
 * A lista sai de `contato_candidato`: os candidatos que ESTA pessoa ouviu na
 * primeira mensagem. Não é a chapa atual do atendente — quem entrou depois não
 * aparece, porque ela nunca foi avisada dele.
 */
/**
 * ⚠️ O MATERIAL NÃO ESPERA MAIS INTERVALO, e esta tela travava por isso.
 *
 * Até os quatro passos, `material` era uma etapa de abordagem e o intervalo
 * valia para ela — daí os botões desabilitados com "aguarde 40s". Quando a
 * conversa passou a ser abertura → minha escolha → permissão → material, quem
 * ficou como abordagem foi só a ABERTURA: o material vai para quem acabou de
 * dizer "pode", e fazer essa pessoa esperar não protege número nenhum.
 *
 * O servidor já parou de recusar. A tela continuava travando sozinha, contra
 * uma regra que não existe mais — e o atendente ficava olhando um botão cinza
 * sem nada acontecendo do outro lado.
 *
 * O conselho de mandar um de cada vez continua, como conselho. É o que ele é.
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
          : 'Mande um de cada vez e espere a resposta. Emendar vários materiais seguidos, mesmo para quem autorizou, é o que derruba número.'}
      </p>
      <p className="mb-4 text-xs leading-relaxed text-suave">
        Sai um link só. Ele abre uma página da pessoa com todas as peças daquele candidato — não
        abra para conferir, porque conta como clique dela.
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

function Regras({
  teto, inicio, fim, emRampa, diaRampa,
}: {
  teto: number; inicio: number; fim: number; emRampa: boolean; diaRampa: number;
}) {
  const regras = [
    'Primeiro só o pedido de permissão.',
    'Material só depois do “pode”.',
    'Uma tentativa por pessoa. Nunca insista.',
    '“Não” é não: marque Pediu saída e agradeça.',
    // O teto do dia com a origem junto: quem lê "até 8" sem saber do
    // aquecimento acha que o gestor configurou 8.
    emRampa
      ? `Até ${teto} conversas hoje (número aquecendo, dia ${diaRampa}), das ${inicio}h às ${fim}h.`
      : `Até ${teto} conversas, das ${inicio}h às ${fim}h.`,
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
