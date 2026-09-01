'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, useTransition } from 'react';
import {
  AlertTriangle, ArrowLeft, Check, ChevronDown, Copy, Gift, History, Loader2, MessageSquarePlus,
  MousePointerClick, PackageOpen, Pencil, Radio, Send, Star, X,
} from 'lucide-react';
import { Avatar, Aviso, Botao, Cartao, EtiquetaOrigem, Pilula, Selecao, cx } from '@/components/ui';
import { CamposEndereco } from '@/components/campos-endereco';
import { ComiteMaisPerto } from '@/components/comite-perto';
import { comitesDoContato } from '@/lib/acoes-comites';
import type { Comite } from '@/lib/comites';
import { carregarModelosLivres } from '@/app/[entrada]/(interno)/gestor/mensagens/livres';
import type { ModeloLivre } from '@/lib/tipos-banco';
import { TAMANHOS_CAMISETA, type EnderecoEstruturado } from '@/lib/cep';
import { carregarItensKit } from '@/lib/acoes-itens-kit';
import { pedeTamanho, type ItemKit } from '@/lib/itens-kit';
import { formatarExibicao } from '@/lib/telefone';
import { abrirNaAbaDoWhatsapp, temExtensao } from '@/lib/whatsapp-aba';
import {
  DICA_RESULTADO, RESULTADOS_COM_TEXTO, RESULTADOS_OUTROS, RESULTADOS_RAPIDOS,
  COR_STATUS_CONTATO, ROTULO_CARGO, ROTULO_ETAPA, ROTULO_RESULTADO, ROTULO_STATUS_CONTATO,
  PASSOS_DA_CONVERSA,
  type Chip, type Contato, type EntregaDoContato, type EtapaMsg, type Municipio,
  type PassoDaConversa, type Resultado,
} from '@/lib/tipos-banco';
import {
  carregarCorrecoes, carregarEntregas, corrigirContato, definirMunicipio, prepararMensagem,
  registrarAbertura, registrarResultado,
  type MensagemPronta,
} from '@/app/[entrada]/(interno)/painel/acoes';
import { carregarHistorico, registrarPedidoKit, type Historico, type PedidoKit as DadosPedidoKit } from './acoes';

const JANELA_WA = 'whatsapp-atendimento';

/**
 * Mensagens que valem para a conversa toda, sem dono.
 *
 * Material e convite ao canal NÃO estão aqui: são de um candidato específico e
 * ganham a própria lista, montada a partir de quem foi declarado a esta pessoa.
 */
/**
 * Os passos da abordagem que ainda faltam para esta pessoa.
 *
 * ⚠️ Precisa existir AQUI, e não só na tela de atender. Com quatro passos, o
 * caminho mais comum passou a ser: manda o "oi", a pessoa não responde na hora,
 * o contato vai para "Meus contatos" — e é por esta tela que a conversa
 * continua, dias depois. Sem isto, quem recebeu só a Abertura nunca receberia o
 * resto, e a conversa morreria no "oi".
 *
 * Sai do HISTÓRICO, que é o que o servidor gravou. A tela não guarda memória
 * própria de qual mensagem já saiu: repetir uma que a pessoa já recebeu é o
 * erro mais caro que ela pode cometer.
 */
const ROTULO_PASSO: Record<PassoDaConversa, { rotulo: string; dica: string }> = {
  abertura: { rotulo: '1. Abertura', dica: 'só o oi — e espere responder' },
  minha_escolha: { rotulo: '2. Minha escolha', dica: 'conte em quem você votou e por quê' },
  permissao: { rotulo: '3. Permissão', dica: 'peça para mandar o material' },
};

const MENSAGENS: { etapa: EtapaMsg; rotulo: string; dica: string }[] = [
  { etapa: 'quem_passou', rotulo: 'Quem passou meu número', dica: 'quando ela pergunta de onde veio' },
  { etapa: 'quer_ajudar', rotulo: 'Quer ajudar', dica: 'quando se oferece para ajudar' },
  { etapa: 'encaminhamento', rotulo: 'Encaminhamento', dica: 'quando pede algo que não podemos prometer' },
  { etapa: 'saida', rotulo: 'Saída', dica: 'confirma que o contato saiu da lista' },
];

const MOTIVO: Record<string, string> = {
  modelo_obrigatorio: 'Escolha qual mensagem mandar.',
  sem_chapa:
    'Você ainda não tem candidato atribuído. Fale com o gestor antes de abrir a conversa — ' +
    'a primeira mensagem sairia sem dizer de quem é o material.',
  saida_pedida_pela_pessoa:
    'Não dá. Quem pediu para sair foi a própria pessoa, pelo link. Isso só ela pode desfazer.',
  saida_so_o_gestor_desfaz:
    'Não dá para desfazer por aqui — mandar mensagem para quem pediu para sair é multa por ' +
    'mensagem, então quem decide isso é o gestor. Já avisei ele, com esta pessoa em anexo. ' +
    'Se ele liberar, a conversa volta para você do jeito que estava.',
  candidato_nao_declarado:
    'Esta pessoa não foi avisada deste candidato, então não dá para mandar o material dele. ' +
    'Ela só autorizou o que estava escrito na primeira mensagem.',
  candidato_inativo: 'Este candidato foi desativado pelo gestor.',
  sem_endereco:
    'O sistema não sabe o endereço público do painel, então o link do material sairia quebrado. ' +
    'Não mande nada — avise o gestor para configurar LINK_BASE_URL.',
  candidato_obrigatorio: 'Escolha de qual candidato é a mensagem.',
  contato_bloqueado: 'Esta pessoa pediu para sair. Não dá para mandar mais nada.',
  dados_ja_apagados: 'Os dados desta pessoa já foram apagados. Não há o que corrigir.',
  contato_nao_e_seu: 'Este contato não está com você.',
  conversa_nao_aberta: 'Você ainda não abriu conversa com esta pessoa.',
  dados_apagados: 'Os dados desta pessoa já foram apagados.',
  sem_itens: 'Escolha pelo menos um item.',
  dia_bloqueado: 'Hoje é dia bloqueado — não se fala com ninguém. Nada foi enviado.',
  fora_de_horario: 'O horário de atendimento acabou. Nada foi enviado; continue amanhã.',
  chip_indisponivel: 'Seu número está pausado ou foi desativado. Nada foi enviado — fale com o gestor.',
  teto_atingido: 'Você chegou ao limite de conversas deste número hoje. Nada foi enviado.',
  intervalo:
    'Ainda falta o intervalo entre uma abordagem e outra. Nada foi enviado — espere um pouco e tente de novo.',
  chip_nao_e_seu: 'Esse número não está no seu cadastro. Fale com o gestor.',
  modelo_ausente: 'Não existe modelo cadastrado para esta mensagem. Fale com o gestor.',
  sem_variacao: 'O modelo está sem texto. Fale com o gestor.',
};

export function Perfil({
  contato, chips, municipios, atendente, entrada,
}: {
  contato: Contato; chips: Chip[]; municipios: Municipio[]; atendente: string; entrada: string;
}) {
  const [historico, setHistorico] = useState<Historico | null>(null);
  const [entregas, setEntregas] = useState<EntregaDoContato[]>([]);
  const [correcoes, setCorrecoes] = useState<Awaited<ReturnType<typeof carregarCorrecoes>>>([]);
  /** As mensagens que o gestor escreveu, fora das sete etapas fixas. */
  const [livres, setLivres] = useState<ModeloLivre[]>([]);
  useEffect(() => { void carregarModelosLivres(true).then(setLivres); }, []);
  const [status, setStatus] = useState(contato.status);
  const [mensagem, setMensagem] = useState<MensagemPronta | null>(null);
  /** O texto livre de "Encaminhar" e "Outro". Ver `RESULTADOS_COM_TEXTO`. */
  const [observacao, setObservacao] = useState(contato.encaminhamento ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  // Nome e telefone vivem em estado porque podem ser corrigidos aqui mesmo: o
  // nome vem torto da planilha, e a pessoa às vezes diz "esse número é do meu
  // filho, o meu é outro".
  const [nome, setNome] = useState(contato.nome ?? contato.primeiro_nome ?? '');
  const [telefone, setTelefone] = useState(contato.telefone_e164 ?? '');

  const chipId = contato.chip_id ?? chips[0]?.id ?? '';
  const apagado = contato.anonimizado_em !== null;

  // Os passos da abordagem que ainda faltam. `null` de histórico ainda
  // carregando NÃO vira "faltam todos": ofereceria remandar o que já saiu.
  const enviadas = historico?.ok ? historico.interacoes.map((i) => i.etapa) : null;
  const passosQueFaltam = enviadas
    ? PASSOS_DA_CONVERSA.filter((e) => !enviadas.includes(e))
    : [];

  /**
   * Recarrega tudo que a tela mostra sobre este contato.
   *
   * `useCallback` porque ela é dependência do efeito abaixo — sem isso, uma
   * função nova a cada renderização faria o efeito rodar em laço.
   */
  const recarregar = useCallback(() => {
    void carregarHistorico(contato.id).then(setHistorico);
    void carregarEntregas(contato.id).then(setEntregas);
    void carregarCorrecoes(contato.id).then(setCorrecoes);
  }, [contato.id]);

  useEffect(() => { recarregar(); }, [recarregar]);

  function preparar(etapa: EtapaMsg, candidatoId?: string, modeloLivreId?: string) {
    setErro(null); setOk(null); setMensagem(null);
    iniciar(async () => {
      const m = await prepararMensagem(
        contato.id, chipId, etapa, candidatoId ?? null, modeloLivreId ?? null,
      );
      if (!m.ok) { setErro(MOTIVO[m.motivo] ?? `Não consegui montar a mensagem (${m.motivo}).`); return; }
      setMensagem(m);
    });
  }

  /**
   * Mesma ordem da tela de atendimento, pelo mesmo motivo: a janela abre em
   * branco no clique (síncrono, senão o navegador bloqueia o pop-up) e só é
   * apontada para o WhatsApp depois de o servidor autorizar. Com URL vazia,
   * `window.open` não navega uma janela nomeada que já exista — a aba de
   * WhatsApp em uso fica onde está.
   */
  function abrir() {
    if (!mensagem) return;
    // Com a extensão, quem acha a aba do WhatsApp é ela — inclusive a que o
    // atendente abriu sozinho. Ver `src/lib/whatsapp-aba.ts`.
    const pelaExtensao = temExtensao();
    const janela = pelaExtensao ? null : window.open('', JANELA_WA);
    setErro(null); setOk(null);
    const enviada = mensagem;
    iniciar(async () => {
      const r = await registrarAbertura(
        contato.id, chipId, enviada.etapa, enviada.variacaoId,
        enviada.candidato?.id ?? null, enviada.modeloLivreId,
      );
      if (!r.ok) {
        // Não navega: nada chega ao WhatsApp.
        setErro(MOTIVO[r.motivo] ?? `O sistema não registrou o envio: ${r.motivo}`);
        return;
      }
      if (!pelaExtensao || !(await abrirNaAbaDoWhatsapp(enviada.urlWhatsApp))) {
        if (janela && !janela.closed) janela.location.href = enviada.urlWhatsApp;
        else window.open(enviada.urlWhatsApp, JANELA_WA);
      }
      setOk('Envio registrado.');
      recarregar();
    });
  }

  /**
   * Copia o texto em vez de abrir o WhatsApp.
   *
   * ⚠️ PASSA PELO MESMO `registrarAbertura` que o botão de abrir, e isso não é
   * detalhe: copiar é o passo anterior a enviar. Se copiar não registrasse, o
   * teto do dia, o intervalo entre abordagens e a trilha de auditoria
   * deixariam de enxergar a mensagem — e o atendente teria, sem querer, um
   * caminho para furar as três coisas. A mesma razão pela qual `src/lib/bots.ts`
   * existe: métrica que não vê o que aconteceu é pior que métrica nenhuma.
   *
   * Serve para quem já está com a conversa aberta no WhatsApp Web e não quer
   * que a aba recarregue.
   */
  function copiar() {
    if (!mensagem) return;
    setErro(null); setOk(null);
    const enviada = mensagem;
    iniciar(async () => {
      const r = await registrarAbertura(
        contato.id, chipId, enviada.etapa, enviada.variacaoId,
        enviada.candidato?.id ?? null, enviada.modeloLivreId,
      );
      if (!r.ok) {
        setErro(MOTIVO[r.motivo] ?? `O sistema não registrou o envio: ${r.motivo}`);
        return;
      }
      try {
        await navigator.clipboard.writeText(enviada.texto);
        setOk('Texto copiado, e o envio ficou registrado. Cole na conversa que já está aberta.');
      } catch {
        // Área de transferência negada (permissão, aba sem foco, navegador
        // antigo). O envio JÁ está registrado, então não dá para fingir que
        // nada aconteceu: o atendente precisa saber que pode copiar à mão.
        setOk('O envio foi registrado, mas não consegui copiar sozinho. Selecione o texto acima e copie na mão.');
      }
      recarregar();
    });
  }

  function marcar(resultado: Resultado) {
    setErro(null); setOk(null);
    if (RESULTADOS_COM_TEXTO.includes(resultado) && !observacao.trim()) {
      setErro(resultado === 'encaminhado'
        ? 'Escreva em uma linha o que a pessoa pediu, para a equipe saber o que encaminhar.'
        : 'Escreva em uma linha o que aconteceu — senão "Outro" não diz nada a ninguém.');
      return;
    }
    iniciar(async () => {
      const r = await registrarResultado(
        contato.id, resultado, null,
        RESULTADOS_COM_TEXTO.includes(resultado) ? observacao : null,
      );
      if (!r.ok) { setErro(MOTIVO[r.motivo] ?? `Não consegui gravar: ${r.motivo}`); return; }
      setStatus(resultado);
      setOk(`Marcado como "${ROTULO_RESULTADO[resultado]}".`);
      recarregar();
    });
  }

  const clicou = historico?.ok && historico.cliques.length > 0;

  return (
    <div className="space-y-5">
      <Link href={`/${entrada}/painel/meus-contatos`}
            className="inline-flex items-center gap-1.5 text-sm text-suave transition-colors hover:text-texto">
        <ArrowLeft size={15} /> Meus contatos
      </Link>

      <Cartao className="p-6" elevado>
        <div className="flex flex-wrap items-center gap-4">
          <Avatar nome={nome || contato.primeiro_nome} tamanho="g" />
          <div className="mr-auto min-w-0">
            <Identidade
              contatoId={contato.id}
              nome={nome} telefone={telefone}
              apagado={apagado}
              municipio={contato.municipio_id
                ? municipios.find((m) => m.id === contato.municipio_id)?.nome ?? null
                : null}
              aoCorrigir={(n, t) => { setNome(n); setTelefone(t); recarregar(); }}
            />
          </div>
          <EtiquetaOrigem origem={contato.origem} />
          <Pilula cor={COR_STATUS_CONTATO[status]}>{ROTULO_STATUS_CONTATO[status] ?? status}</Pilula>
        </div>

        {clicou && (
          <p className="mt-4 flex items-center gap-2 rounded-2xl border border-ok/25 bg-ok/10 px-4 py-3 text-sm text-ok">
            <MousePointerClick size={16} className="shrink-0" />
            Abriu o link que você mandou. É o sinal mais confiável de que a pessoa está interessada.
          </p>
        )}
      </Cartao>

      {erro && <Aviso tom="erro">{erro}</Aviso>}
      {ok && <Aviso tom="ok">{ok}</Aviso>}

      {apagado ? (
        <Aviso tom="alerta">
          Esta pessoa pediu para sair e os dados dela já foram apagados, como a lei exige.
          Não é possível mandar mensagem nem editar nada.
        </Aviso>
      ) : (
        <>
          {/* ⚠️ A ORDEM É A DA CONVERSA, e mudou a pedido de quem opera:
              primeiro o que se MANDA, depois como ela TERMINOU, e o material só
              quando houver o quê mandar. Antes o cartão de resultado vinha em
              cima, o que fazia a ficha começar perguntando o fim. */}
          <Cartao className="p-6">
            <h2 className="mb-1 flex items-center gap-2 font-semibold"><MessageSquarePlus size={16} className="text-suave" /> Mensagens</h2>
            <p className="mb-3 text-xs text-suave">
              É daqui que sai a primeira mensagem e todas as outras. Valem para a conversa
              inteira, sem candidato — o texto sai pronto.
            </p>
            {passosQueFaltam.length > 0 && (
              <div className="mb-4 rounded-2xl border border-acento/30 bg-acento/5 p-3.5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-acento">
                  A conversa parou no meio
                </p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {passosQueFaltam.map((e) => (
                    <button key={e} type="button" disabled={ocupado}
                            onClick={() => preparar(e)}
                            className={cx(
                              'rounded-xl border p-3 text-left transition-colors disabled:opacity-50',
                              mensagem?.etapa === e && !mensagem.candidato
                                ? 'border-acento/50 bg-acento/10'
                                : 'border-borda hover:border-borda-forte hover:bg-superficie-alta',
                            )}>
                      <span className="block text-sm font-medium">{ROTULO_PASSO[e].rotulo}</span>
                      <span className="block text-xs text-suave">{ROTULO_PASSO[e].dica}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MENSAGENS.map((m) => (
                <button key={m.etapa} type="button" disabled={ocupado}
                        onClick={() => preparar(m.etapa)}
                        className={cx(
                          'rounded-2xl border p-3.5 text-left transition-colors disabled:opacity-50',
                          mensagem?.etapa === m.etapa && !mensagem.candidato
                            ? 'border-acento/50 bg-acento/10'
                            : 'border-borda hover:border-borda-forte hover:bg-superficie-alta',
                        )}>
                  <span className="block text-sm font-medium">{m.rotulo}</span>
                  <span className="block text-xs text-suave">{m.dica}</span>
                </button>
              ))}
            </div>

            {livres.length > 0 && (
              <>
                <p className="mb-2 mt-5 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
                  Do gestor
                </p>
                <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                  {livres.map((m) => (
                    <button key={m.id} type="button" disabled={ocupado}
                            onClick={() => preparar('livre', undefined, m.id)}
                            className={cx(
                              'rounded-2xl border p-3.5 text-left transition-colors disabled:opacity-50',
                              mensagem?.modeloLivreId === m.id
                                ? 'border-acento/50 bg-acento/10'
                                : 'border-borda hover:border-borda-forte hover:bg-superficie-alta',
                            )}>
                      <span className="block text-sm font-medium">{m.nome}</span>
                      {m.dica && <span className="block text-xs text-suave">{m.dica}</span>}
                    </button>
                  ))}
                </div>
              </>
            )}

            {/* ⚠️ `!mensagem.candidato` é a correção de um defeito de tela real:
                `mensagem` é um estado só, e esta prévia estava DENTRO deste
                cartão. Clicar em "Mandar material" no cartão de cima fazia o
                texto aparecer aqui embaixo, fora da vista — e o botão parecia
                não ter feito nada. Agora cada cartão mostra a própria prévia. */}
            {mensagem && !mensagem.candidato && (
              <div className="mt-4 border-t border-borda pt-4">
                <PreviaDaMensagem
                  mensagem={mensagem} ocupado={ocupado} aoAbrir={abrir} aoCopiar={copiar}
                />
              </div>
            )}
          </Cartao>

          <Cartao className="p-6">
            <h2 className="mb-1 flex items-center gap-2 font-semibold"><Check size={16} className="text-suave" /> Resultado do contato</h2>
            <p className="mb-3 text-xs text-suave">
              Como esta conversa terminou. Serve para marcar pela primeira vez — número inválido
              logo na abertura, autorizou depois da permissão — e para corrigir quando a pessoa
              responde dias depois ou quando você clicou no botão errado.
            </p>
            <MudarResultado
              atual={status} ocupado={ocupado} texto={observacao}
              aoMarcar={marcar} aoMudarTexto={setObservacao}
            />
          </Cartao>

          {/* ⚠️ SÓ DEPOIS DO "AUTORIZOU". Antes ele aparecia sempre, e numa
              ficha de quem disse "não quero" o painel oferecia mandar material
              — é o convite para o erro mais caro que existe aqui. O servidor já
              recusaria, mas oferecer o que vai ser recusado é a tela ensinando
              errado. */}
          {status === 'autorizou' && (
            <PorCandidato
              entregas={entregas} ocupado={ocupado} mensagem={mensagem}
              aoPreparar={preparar} aoAbrir={abrir} aoCopiar={copiar}
            />
          )}

          {historico?.ok && (
            <PedidoKit
              key={historico.pedido_kit?.em ?? 'novo'}
              contatoId={contato.id}
              municipios={municipios}
              municipioId={contato.municipio_id}
              pedido={historico.pedido_kit}
              aoSalvar={recarregar}
            />
          )}
        </>
      )}

      <Cartao className="p-6">
        <h2 className="mb-4 flex items-center gap-2 font-semibold"><History size={16} className="text-suave" /> Histórico</h2>
        {!historico ? (
          <p className="text-sm text-suave">carregando…</p>
        ) : !historico.ok ? (
          <p className="text-sm text-suave">{MOTIVO[historico.motivo] ?? historico.motivo}</p>
        ) : historico.interacoes.length === 0 && historico.cliques.length === 0
             && correcoes.length === 0 ? (
          <p className="text-sm text-suave">Nada registrado ainda.</p>
        ) : (
          <ol className="space-y-3">
            {historico.interacoes.map((i, k) => (
              <li key={k} className="border-l-2 border-borda pl-4">
                <p className="text-sm font-medium">
                  Você mandou: {ROTULO_ETAPA[i.etapa] ?? i.etapa}
                  {i.candidato && <span className="text-suave"> · {i.candidato}</span>}
                </p>
                <p className="text-xs text-suave">
                  {new Date(i.aberto_wa_em).toLocaleString('pt-BR')}
                </p>
                {i.texto_enviado && (
                  <p className="mt-1 line-clamp-2 text-xs text-suave">{i.texto_enviado}</p>
                )}
              </li>
            ))}
            {historico.cliques.map((c, k) => (
              <li key={`c${k}`} className="border-l-2 border-acento pl-4">
                <p className="text-sm font-semibold text-acento">
                  A pessoa abriu: {c.peca}
                  {c.candidato && <span className="font-normal text-suave"> · {c.candidato}</span>}
                </p>
                <p className="text-xs text-suave">{new Date(c.quando).toLocaleString('pt-BR')}</p>
              </li>
            ))}
            {/* Trocar o telefone de uma ficha é dizer "esta conversa agora é de
                outra pessoa". Sem aparecer aqui, o rastro no banco não serviria
                para nada: ninguém abre uma tabela para entender uma tela. */}
            {correcoes.map((c, k) => (
              <li key={`x${k}`} className="border-l-2 border-borda-forte pl-4">
                <p className="text-sm">
                  {c.autor ?? 'Alguém'} corrigiu o {c.campo === 'nome' ? 'nome' : 'número'}
                </p>
                <p className="text-xs text-suave">
                  de <span className="line-through">{
                    c.campo === 'telefone' && c.de ? formatarExibicao(c.de) : c.de ?? '(vazio)'
                  }</span>
                  {' '}para <strong className="text-texto">{
                    c.campo === 'telefone' && c.para ? formatarExibicao(c.para) : c.para ?? '(vazio)'
                  }</strong>
                </p>
                <p className="text-xs text-suave">{new Date(c.criado_em).toLocaleString('pt-BR')}</p>
              </li>
            ))}
          </ol>
        )}
      </Cartao>

      <p className="text-xs text-suave">
        Atendido por {atendente}. Nunca anote em quem a pessoa vota — nem aqui, nem em lugar nenhum.
      </p>
    </div>
  );
}

/* ── Nome e telefone, corrigíveis ────────────────────────────────────────── */

const MOTIVO_CORRECAO: Record<string, string> = {
  numero_bloqueado:
    'Esse número pediu para sair da lista. Não dá para apontar um contato para ele — ' +
    'só o gestor pode liberar.',
  numero_ja_existe: 'Esse número já é de outro contato na base.',
  contato_nao_e_seu: 'Este contato não está com você.',
  dados_ja_apagados: 'Os dados desta pessoa já foram apagados.',
  usuario_inativo: 'Sua conta está inativa. Fale com o gestor.',
  telefone_invalido: 'Confira o número.',
};

/**
 * O nome e o telefone da pessoa, com o lápis que corrige.
 *
 * ⚠️ NÃO É EDIÇÃO DE RÓTULO. O nome é o que sai na saudação da próxima
 * mensagem ("Bom dia, MARIA DAS D SILVA!" era o que a planilha produzia), e o
 * telefone é a IDENTIDADE da pessoa no sistema: `chave_dedup` tem índice único
 * e o HMAC é o que liga a lista de bloqueio.
 *
 * Por isso as duas correções ficam gravadas em `contato_correcoes`, com autor e
 * data, e aparecem no Histórico. Trocar o número de uma ficha é dizer "esta
 * conversa agora é de outra pessoa" — sem rastro, ninguém consegue olhar para
 * trás e entender o que aconteceu.
 */
function Identidade({
  contatoId, nome, telefone, municipio, apagado, aoCorrigir,
}: {
  contatoId: string;
  nome: string;
  telefone: string;
  municipio: string | null;
  apagado: boolean;
  aoCorrigir: (nome: string, telefone: string) => void;
}) {
  const [editando, setEditando] = useState(false);
  const [rascunhoNome, setRascunhoNome] = useState(nome);
  const [rascunhoTel, setRascunhoTel] = useState(telefone);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  if (!editando) {
    return (
      <>
        <h1 className="flex items-center gap-2 font-display text-2xl font-semibold tracking-tight">
          <span className="truncate">
            {nome || <span className="text-tenue">(dados apagados)</span>}
          </span>
          {!apagado && (
            <button type="button" title="Corrigir nome ou número"
                    onClick={() => {
                      setRascunhoNome(nome); setRascunhoTel(telefone);
                      setErro(null); setEditando(true);
                    }}
                    className="shrink-0 text-suave transition-colors hover:text-texto">
              <Pencil size={14} />
            </button>
          )}
        </h1>
        <p className="mt-0.5 truncate text-sm text-suave">
          {telefone ? formatarExibicao(telefone) : '—'}
          {municipio && ` · ${municipio}`}
        </p>
      </>
    );
  }

  return (
    <form
      className="space-y-2"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await corrigirContato({
            contatoId,
            nome: rascunhoNome,
            // Só manda o telefone se mudou: o servidor recalcula o HMAC e o
            // dedup, e mandar o mesmo número gera trabalho para nada.
            telefone: rascunhoTel.replace(/\D/g, '') === telefone ? null : rascunhoTel,
          });
          if (!r.ok) {
            setErro(
              r.motivo === 'numero_ja_existe' && r.atendente
                ? `Esse número já é de outro contato, com ${r.atendente}.`
                : r.detalhe ?? MOTIVO_CORRECAO[r.motivo] ?? `Não consegui salvar (${r.motivo}).`,
            );
            return;
          }
          setErro(null);
          setEditando(false);
          aoCorrigir(rascunhoNome.trim(), rascunhoTel.replace(/\D/g, '') || telefone);
        });
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <input
          autoFocus value={rascunhoNome} maxLength={120}
          onChange={(e) => setRascunhoNome(e.target.value)}
          aria-label="Nome do contato"
          className="min-w-0 flex-1 rounded-xl border border-borda-forte bg-superficie-alta px-3 py-2 text-lg font-semibold text-texto"
        />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <input
          value={rascunhoTel} type="tel" inputMode="tel" maxLength={24}
          onChange={(e) => setRascunhoTel(e.target.value)}
          aria-label="WhatsApp do contato"
          className="w-48 rounded-xl border border-borda-forte bg-superficie-alta px-3 py-2 text-sm text-texto"
        />
        <Botao type="submit" tamanho="p" disabled={ocupado}>
          {ocupado ? <><Loader2 size={13} className="animate-spin" /> Salvando…</> : <><Check size={13} /> Salvar</>}
        </Botao>
        <Botao type="button" tamanho="p" variante="neutro" disabled={ocupado}
               onClick={() => { setErro(null); setEditando(false); }}>
          <X size={13} /> Cancelar
        </Botao>
      </div>
      {erro
        ? <p className="text-xs text-perigo">{erro}</p>
        : <p className="text-xs leading-relaxed text-suave">
            O nome é o que sai na saudação da próxima mensagem. Trocar o número muda a identidade
            desta ficha — as duas correções ficam registradas no histórico, com seu nome.
          </p>}
    </form>
  );
}

/* ── A prévia do texto, com os dois caminhos de envio ────────────────────── */

/**
 * O texto pronto e o que fazer com ele.
 *
 * Existe como componente porque é renderizado em DOIS lugares — dentro da linha
 * do candidato e dentro de "Mandar outra mensagem" —, e ter duas cópias do
 * bloco garantiria que uma delas ficasse para trás.
 *
 * ⚠️ Os dois botões registram o envio no servidor. "Copiar" não é um atalho
 * que pula a auditoria: é o mesmo caminho, para quem já está com a conversa
 * aberta no WhatsApp Web e não quer que a aba recarregue.
 */
function PreviaDaMensagem({
  mensagem, ocupado, aoAbrir, aoCopiar,
}: {
  mensagem: MensagemPronta;
  ocupado: boolean;
  aoAbrir: () => void;
  aoCopiar: () => void;
}) {
  return (
    <>
      <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md border border-borda bg-superficie-alta p-5 text-[15px] leading-[1.7]">
        {mensagem.texto}
      </div>
      <div className="mt-4 flex flex-wrap gap-2.5">
        <Botao tamanho="g" className="min-w-[12rem] flex-1" onClick={aoAbrir} disabled={ocupado}>
          {ocupado
            ? <><Loader2 size={17} className="animate-spin" /> Registrando…</>
            : <><Send size={17} /> Abrir conversa no WhatsApp</>}
        </Botao>
        <Botao tamanho="g" variante="neutro" onClick={aoCopiar} disabled={ocupado}
               title="Copia o texto e registra o envio, sem recarregar o WhatsApp Web">
          <Copy size={16} /> Copiar texto
        </Botao>
      </div>
      <p className="mt-2 text-xs leading-relaxed text-suave">
        Os dois registram o envio. Use <strong className="text-texto">Copiar</strong> quando a
        conversa já estiver aberta do lado — assim a aba do WhatsApp não recarrega.
      </p>
    </>
  );
}

/* ── Corrigir o desfecho ─────────────────────────────────────────────────── */

/**
 * Onze desfechos numa tela de correção.
 *
 * Aqui, ao contrário da tela de atendimento, não há atalho de teclado nem
 * pressa: quem abre este cartão veio corrigir uma coisa específica. Então os
 * onze cabem, com o atual em destaque — mas os seis que entraram depois
 * continuam atrás de um clique, para a lista não virar um paredão.
 */
function MudarResultado({
  atual, ocupado, texto, aoMarcar, aoMudarTexto,
}: {
  atual: string;
  ocupado: boolean;
  texto: string;
  aoMarcar: (r: Resultado) => void;
  aoMudarTexto: (v: string) => void;
}) {
  const [abertos, setAbertos] = useState(RESULTADOS_OUTROS.includes(atual as Resultado));

  /**
   * O desfecho armado, esperando o segundo clique.
   *
   * ⚠️ Dois cliques aqui também, pelo mesmo motivo da tela de atendimento: são
   * onze botões parecidos numa grade, e trocar o desfecho de alguém por engano
   * tira a pessoa da fila ou a põe de volta sem ninguém perceber. Clicar noutro
   * desfecho desarma o primeiro — ninguém confirma o que não escolheu.
   */
  const [confirmando, setConfirmando] = useState<Resultado | null>(null);

  function clicar(r: Resultado) {
    if (confirmando !== r) { setConfirmando(r); return; }
    setConfirmando(null);
    aoMarcar(r);
  }

  const botao = (r: Resultado) => {
    const armado = confirmando === r;
    return (
      <button key={r} type="button" disabled={ocupado} onClick={() => clicar(r)}
              className={cx(
                'rounded-2xl border p-3.5 text-left transition-colors disabled:opacity-45',
                armado
                  ? 'border-perigo bg-perigo/15'
                  : r === atual
                    ? 'border-acento/50 bg-acento/10'
                    : r === 'pediu_saida'
                      ? 'border-perigo/40 hover:border-perigo hover:bg-perigo/10'
                      : 'border-borda hover:border-borda-forte hover:bg-superficie-alta',
              )}>
        <span className={cx(
          'block text-sm font-semibold',
          armado ? 'text-perigo' : r === 'pediu_saida' && r !== atual && 'text-perigo',
        )}>
          {armado ? `Confirmar: ${ROTULO_RESULTADO[r]}` : ROTULO_RESULTADO[r]}
        </span>
        <span className="mt-1 block text-xs leading-relaxed text-suave">
          {armado ? 'Clique de novo para gravar.' : DICA_RESULTADO[r]}
        </span>
      </button>
    );
  };

  return (
    <>
      <div className="grid gap-2.5 sm:grid-cols-2">
        {RESULTADOS_RAPIDOS.map(botao)}
      </div>

      {confirmando && (
        <p className="mt-2.5 text-xs leading-relaxed text-perigo">
          {confirmando === 'pediu_saida'
            ? 'Clique de novo para confirmar. “Pediu saída” bloqueia o número para sempre e apaga os dados em 48h — e desfazer depois depende do gestor.'
            : `Clique de novo para confirmar “${ROTULO_RESULTADO[confirmando]}”. Se errou, é só clicar noutro desfecho.`}
        </p>
      )}

      <button type="button" onClick={() => setAbertos((v) => !v)} aria-expanded={abertos}
              className="mt-3 flex items-center gap-1.5 text-xs font-semibold text-acento">
        <ChevronDown size={14} className={cx('transition-transform', abertos && 'rotate-180')} />
        {abertos ? 'Menos desfechos' : 'Outros desfechos'}
      </button>

      {abertos && (
        <div className="mt-3 grid gap-2.5 sm:grid-cols-2">
          {RESULTADOS_OUTROS.map(botao)}
        </div>
      )}

      <label className="mt-4 block">
        <span className="text-xs leading-relaxed text-suave">
          Para <strong className="text-texto">Encaminhar</strong> ou{' '}
          <strong className="text-texto">Outro</strong>, escreva em uma linha o que aconteceu.
          {' '}Não escreva em quem a pessoa vota — isso não pode ser registrado.
        </span>
        <input
          value={texto} onChange={(e) => aoMudarTexto(e.target.value)}
          maxLength={280} placeholder="ex.: perguntou sobre vaga de emprego"
          className="mt-2 w-full rounded-2xl border border-borda bg-superficie-alta px-4 py-2.5 text-sm placeholder:text-tenue"
        />
      </label>
    </>
  );
}

/* ── Mensagens que pertencem a um candidato ─────────────────────────────── */

/**
 * A lista sai de `contato_candidato`: quem foi declarado a ESTA pessoa. Não é
 * a chapa atual do atendente — um candidato que entrou depois não pode alcançar
 * quem autorizou sem saber dele.
 */
function PorCandidato({
  entregas, ocupado, mensagem, aoPreparar, aoAbrir, aoCopiar,
}: {
  entregas: EntregaDoContato[];
  ocupado: boolean;
  /** A mensagem montada agora. A prévia dela aparece AQUI quando é daqui. */
  mensagem: MensagemPronta | null;
  aoPreparar: (etapa: EtapaMsg, candidatoId: string) => void;
  aoAbrir: () => void;
  aoCopiar: () => void;
}) {
  const escolhido = mensagem?.candidato?.id ?? null;
  const etapaEscolhida = mensagem?.candidato ? mensagem.etapa : null;
  return (
    <Cartao className="p-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <PackageOpen size={16} className="text-suave" /> Material por candidato
      </h2>
      <p className="mb-3 text-xs leading-relaxed text-suave">
        Só aparecem os candidatos que esta pessoa ouviu na primeira mensagem.
        <br />
        <strong className="text-texto">Mandar material</strong> manda a página do candidato,
        com todas as peças dele dentro — é a mensagem normal depois do &ldquo;pode&rdquo;.{' '}
        <strong className="text-texto">Convidar pro canal</strong> manda só o link do canal no
        WhatsApp, para quando a pessoa perguntar se tem grupo.
        <br />
        Ela recebe <strong className="text-texto">um link</strong>: ele abre uma página só dela,
        com as peças daquele candidato, o CNPJ da campanha e o botão de sair. Não abra esse link
        para conferir — conta como clique dela.
      </p>

      {entregas.length === 0 ? (
        <p className="text-sm text-suave">
          Nenhum candidato liberado para esta pessoa ainda. Libera quando a primeira mensagem
          — o pedido de permissão — é registrada.
        </p>
      ) : (
        <div className="space-y-2">
          {entregas.map((c) => {
            const marcado = (etapa: EtapaMsg) => escolhido === c.candidato_id && etapaEscolhida === etapa;
            const aqui = escolhido === c.candidato_id;
            return (
              <div key={c.candidato_id}
                   className={cx('rounded-2xl border p-3.5 transition-colors',
                     aqui ? 'border-acento/50 bg-acento/[0.07]' : 'border-borda')}>
              <div className="flex flex-wrap items-center gap-3">
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
                    {c.material_enviado_em &&
                      ` · material enviado em ${new Date(c.material_enviado_em).toLocaleDateString('pt-BR')}`}
                  </p>
                </div>

                {!c.ativo && <Pilula cor="alerta">desativado</Pilula>}
                {c.ativo && c.materiais === 0 && <Pilula cor="alerta">sem material</Pilula>}

                <Botao variante={marcado('material') ? 'principal' : 'neutro'} tamanho="p"
                       disabled={ocupado || !c.ativo || c.materiais === 0}
                       title="Manda a página com todas as peças deste candidato"
                       onClick={() => aoPreparar('material', c.candidato_id)}>
                  Mandar material
                </Botao>
                <Botao variante={marcado('convite_grupo') ? 'principal' : 'neutro'} tamanho="p"
                       disabled={ocupado || !c.ativo || c.canais === 0}
                       title={c.canais === 0
                         ? 'Este candidato não tem canal cadastrado — peça ao gestor'
                         : 'Manda só o link do canal no WhatsApp'}
                       onClick={() => aoPreparar('convite_grupo', c.candidato_id)}>
                  <Radio size={13} /> Convidar pro canal
                </Botao>
              </div>

              {/* ⚠️ A pessoa NÃO ouviu o nome deste candidato: a declaração
                  veio do reparo do gestor, não da primeira mensagem. Mandar o
                  material direto seria entregar propaganda de alguém que ela
                  nunca soube que existia. */}
              {c.declarado_em_reparo && (
                <p className="mt-3 flex gap-2 rounded-xl border border-alerta/30 bg-alerta/10 px-3.5 py-2.5 text-xs leading-relaxed text-alerta">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <span>
                    Esta pessoa <strong>não ouviu o nome de {c.nome_urna}</strong> na primeira
                    mensagem — o gestor liberou depois. Antes de mandar o material, escreva uma
                    linha se apresentando: diga que você ajuda {c.nome_urna} e pergunte se ela
                    quer receber. Se ela disser que não, marque &ldquo;Pediu saída&rdquo;.
                  </span>
                </p>
              )}

              {/* A prévia mora dentro da linha do candidato que a gerou. Antes
                  ela ficava no cartão "Mandar outra mensagem", lá embaixo:
                  clicar aqui parecia não fazer nada. */}
              {aqui && mensagem && (
                <div className="mt-3.5 border-t border-borda pt-3.5">
                  <PreviaDaMensagem
                    mensagem={mensagem} ocupado={ocupado} aoAbrir={aoAbrir} aoCopiar={aoCopiar}
                  />
                </div>
              )}
              </div>
            );
          })}
        </div>
      )}
    </Cartao>
  );
}

function PedidoKit({
  contatoId, municipios, municipioId, pedido, aoSalvar,
}: {
  contatoId: string;
  municipios: Municipio[];
  municipioId: number | null;
  pedido: DadosPedidoKit | null;
  aoSalvar: () => void;
}) {
  // Estado inicial vem direto das props. O componente só é montado depois que o
  // histórico chegou, e a `key` de quem o renderiza faz remontar quando o
  // pedido passa a existir — então não há efeito copiando prop para estado,
  // que causaria uma renderização em cascata a cada carga.
  const [endereco, setEndereco] = useState<EnderecoEstruturado>({
    cep: pedido?.cep ?? null,
    rua: pedido?.rua ?? null,
    numero: pedido?.numero ?? null,
    bairro: pedido?.bairro ?? null,
  });
  const [itens, setItens] = useState<string[]>(pedido?.itens ?? []);
  const [tamanho, setTamanho] = useState(pedido?.tamanho_camiseta ?? '');
  const [cidade, setCidade] = useState<number | ''>(municipioId ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [ocupado, iniciar] = useTransition();

  // O que a pessoa pode pedir vem do cadastro, não de uma lista escrita aqui.
  const [itensKit, setItensKit] = useState<ItemKit[]>([]);
  useEffect(() => { void carregarItensKit().then(setItensKit); }, []);

  // Só os comitês dos candidatos DECLARADOS a esta pessoa — a mesma lista
  // congelada do consentimento. Comitê de candidato que ela nunca ouviu falar
  // não é informação útil: é propaganda que ela não autorizou.
  const [comites, setComites] = useState<Comite[]>([]);
  useEffect(() => { void comitesDoContato(contatoId).then(setComites); }, [contatoId]);

  const municipio = municipios.find((m) => m.id === cidade) ?? null;

  function alternar(valor: string) {
    setSalvo(false);
    setItens((atual) => (atual.includes(valor) ? atual.filter((i) => i !== valor) : [...atual, valor]));
  }

  return (
    <Cartao className="p-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold"><Gift size={16} className="text-suave" /> Pedido de kit</h2>
      <p className="mb-4 text-xs text-suave">
        Se a pessoa pediu santinho, adesivo ou camiseta, anote aqui. Vai direto para o relatório
        que a equipe de entrega usa.
      </p>

      <div className="space-y-2">
        {itensKit.map((i) => (
          <label key={i.chave}
                 className={cx('flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition-colors',
                   itens.includes(i.chave) ? 'border-acento/45 bg-acento/10' : 'border-borda hover:border-borda-forte')}>
            <input type="checkbox" checked={itens.includes(i.chave)} onChange={() => alternar(i.chave)}
                   className="size-5 accent-[var(--acento)]" />
            <span className="text-sm font-medium">{i.rotulo}</span>
          </label>
        ))}
      </div>

      {/* Só aparece com um item que pede tamanho: perguntar o tamanho de quem
          pediu adesivo é campo que a pessoa lê, pensa e deixa em branco. Quais
          itens pedem tamanho é cadastro, não `includes('camiseta')`. */}
      {pedeTamanho(itens, itensKit) && (
        <div className="mt-3">
          <Selecao rotulo="Tamanho da camiseta" value={tamanho}
                   onChange={(e) => { setTamanho(e.target.value); setSalvo(false); }}>
            <option value="">Não informou</option>
            {TAMANHOS_CAMISETA.map((t) => <option key={t} value={t}>{t}</option>)}
          </Selecao>
        </div>
      )}

      <div className="mt-4">
        <Selecao rotulo="Cidade" value={cidade}
                 onChange={(e) => { setCidade(e.target.value ? Number(e.target.value) : ''); setSalvo(false); }}>
          <option value="">Não informou</option>
          {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </Selecao>
      </div>

      <div className="mt-4">
        <p className="mb-2 text-[13px] font-semibold">Endereço para entrega</p>
        <CamposEndereco
          valor={endereco}
          aoMudar={(e) => { setEndereco(e); setSalvo(false); }}
          cidade={municipio ? { nome: municipio.nome, uf: municipio.uf } : null}
        />

        {/* Para quem mora perto, buscar no comitê chega antes da entrega — e é
            uma peça a menos para a campanha rodar. O atendente lê isto na tela
            e passa na conversa. */}
        <ComiteMaisPerto
          comites={comites}
          cep={endereco.cep}
          municipioId={cidade === '' ? null : cidade}
          className="mt-3"
        />
      </div>

      {erro && <Aviso tom="erro" className="mt-3">{erro}</Aviso>}

      <div className="mt-4 flex items-center gap-3">
        <Botao disabled={ocupado || itens.length === 0}
          onClick={() => iniciar(async () => {
            const r = await registrarPedidoKit(
              contatoId, endereco, itens, cidade === '' ? null : cidade, tamanho || null,
            );
            if (!r.ok) { setErro(MOTIVO[r.motivo ?? ''] ?? 'Não consegui salvar.'); return; }
            if (cidade !== '') await definirMunicipio(contatoId, cidade);
            setErro(null); setSalvo(true); aoSalvar();
          })}>
          {ocupado ? 'Salvando…' : 'Salvar pedido'}
        </Botao>
        {salvo && <span className="text-xs text-ok">salvo ✓</span>}
        {itens.length === 0 && <span className="text-xs text-suave">escolha ao menos um item</span>}
      </div>
    </Cartao>
  );
}
