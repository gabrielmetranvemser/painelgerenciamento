'use client';

import Link from 'next/link';
import { useEffect, useState, useTransition } from 'react';
import {
  ArrowLeft, Check, Gift, History, Loader2, MessageSquarePlus, MousePointerClick, PackageOpen,
  Radio, Send, Star,
} from 'lucide-react';
import { Avatar, Aviso, Botao, Cartao, EtiquetaOrigem, Pilula, Selecao, cx } from '@/components/ui';
import { CamposEndereco } from '@/components/campos-endereco';
import { TAMANHOS_CAMISETA, type EnderecoEstruturado } from '@/lib/cep';
import { formatarExibicao } from '@/lib/telefone';
import {
  RESULTADOS, ROTULO_CARGO,
  type Chip, type Contato, type EntregaDoContato, type EtapaMsg, type Municipio, type Resultado,
} from '@/lib/tipos-banco';
import {
  carregarEntregas, definirMunicipio, prepararMensagem, registrarAbertura, registrarResultado,
  type MensagemPronta,
} from '@/app/[entrada]/(interno)/painel/acoes';
import { carregarHistorico, registrarPedidoKit, type Historico, type PedidoKit as DadosPedidoKit } from './acoes';

const JANELA_WA = 'whatsapp-atendimento';

const ROTULO_RESULTADO: Record<Resultado, string> = {
  autorizou: 'Autorizou',
  pediu_saida: 'Pediu saída',
  invalido: 'Número inválido',
  quer_ajudar: 'Quer ajudar',
  encaminhado: 'Encaminhar',
};

const ROTULO_STATUS: Record<string, string> = {
  na_fila: 'Na fila', em_atendimento: 'Aguardando resposta',
  autorizou: 'Autorizou', pediu_saida: 'Pediu saída', invalido: 'Número inválido',
  quer_ajudar: 'Quer ajudar', encaminhado: 'Encaminhado',
  sem_resposta: 'Não respondeu', perdido: 'Perdido (o número caiu)',
};

/**
 * Mensagens que valem para a conversa toda, sem dono.
 *
 * Material e convite ao canal NÃO estão aqui: são de um candidato específico e
 * ganham a própria lista, montada a partir de quem foi declarado a esta pessoa.
 */
const MENSAGENS: { etapa: EtapaMsg; rotulo: string; dica: string }[] = [
  { etapa: 'quem_passou', rotulo: 'Quem passou meu número', dica: 'quando ela pergunta de onde veio' },
  { etapa: 'quer_ajudar', rotulo: 'Quer ajudar', dica: 'quando se oferece para ajudar' },
  { etapa: 'encaminhamento', rotulo: 'Encaminhamento', dica: 'quando pede algo que não podemos prometer' },
  { etapa: 'saida', rotulo: 'Saída', dica: 'confirma que o contato saiu da lista' },
];

/** Rótulo de cada etapa no histórico, incluindo as que são por candidato. */
const ROTULO_ETAPA: Record<EtapaMsg, string> = {
  permissao: 'Pedido de permissão',
  material: 'Material',
  convite_grupo: 'Convite ao canal',
  quem_passou: 'Quem passou meu número',
  quer_ajudar: 'Quer ajudar',
  encaminhamento: 'Encaminhamento',
  saida: 'Saída',
};

const ITENS_KIT = [
  { valor: 'santinho', rotulo: 'Santinho' },
  { valor: 'adesivo', rotulo: 'Adesivo de carro' },
  { valor: 'camiseta', rotulo: 'Camiseta' },
];

const MOTIVO: Record<string, string> = {
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
  const [status, setStatus] = useState(contato.status);
  const [mensagem, setMensagem] = useState<MensagemPronta | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  const chipId = contato.chip_id ?? chips[0]?.id ?? '';
  const apagado = contato.anonimizado_em !== null;

  useEffect(() => {
    void carregarHistorico(contato.id).then(setHistorico);
    void carregarEntregas(contato.id).then(setEntregas);
  }, [contato.id]);

  function recarregar() {
    void carregarHistorico(contato.id).then(setHistorico);
    void carregarEntregas(contato.id).then(setEntregas);
  }

  function preparar(etapa: EtapaMsg, candidatoId?: string) {
    setErro(null); setOk(null); setMensagem(null);
    iniciar(async () => {
      const m = await prepararMensagem(contato.id, chipId, etapa, candidatoId ?? null);
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
    const janela = window.open('', JANELA_WA);
    setErro(null); setOk(null);
    const enviada = mensagem;
    iniciar(async () => {
      const r = await registrarAbertura(
        contato.id, chipId, enviada.etapa, enviada.variacaoId,
        enviada.candidato?.id ?? null,
      );
      if (!r.ok) {
        // Não navega: nada chega ao WhatsApp.
        setErro(MOTIVO[r.motivo] ?? `O sistema não registrou o envio: ${r.motivo}`);
        return;
      }
      if (janela && !janela.closed) janela.location.href = enviada.urlWhatsApp;
      else window.open(enviada.urlWhatsApp, JANELA_WA);
      setOk('Envio registrado.');
      recarregar();
    });
  }

  function marcar(resultado: Resultado) {
    setErro(null); setOk(null);
    iniciar(async () => {
      const r = await registrarResultado(contato.id, resultado);
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
          <Avatar nome={contato.nome ?? contato.primeiro_nome} tamanho="g" />
          <div className="mr-auto min-w-0">
            <h1 className="font-display text-2xl font-semibold tracking-tight">
              {contato.nome ?? contato.primeiro_nome ?? <span className="text-tenue">(dados apagados)</span>}
            </h1>
            <p className="mt-0.5 truncate text-sm text-suave">
              {contato.telefone_e164 ? formatarExibicao(contato.telefone_e164) : '—'}
              {contato.municipio_id &&
                ` · ${municipios.find((m) => m.id === contato.municipio_id)?.nome ?? ''}`}
            </p>
          </div>
          <EtiquetaOrigem origem={contato.origem} />
          <Pilula>{ROTULO_STATUS[status] ?? status}</Pilula>
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
          <Cartao className="p-6">
            <h2 className="mb-1 flex items-center gap-2 font-semibold"><Check size={16} className="text-suave" /> Mudar o resultado</h2>
            <p className="mb-3 text-xs text-suave">
              Serve para quando a pessoa responde dias depois, ou quando você clicou no botão errado.
            </p>
            <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
              {RESULTADOS.map((r) => (
                <Botao key={r} variante={r === status ? 'principal' : r === 'pediu_saida' ? 'perigo' : 'neutro'}
                       disabled={ocupado} onClick={() => marcar(r)} className="!rounded-2xl py-3">
                  {ROTULO_RESULTADO[r]}
                </Botao>
              ))}
            </div>
          </Cartao>

          <PorCandidato
            entregas={entregas} ocupado={ocupado}
            escolhido={mensagem?.candidato?.id ?? null}
            etapaEscolhida={mensagem?.candidato ? mensagem.etapa : null}
            aoPreparar={preparar}
          />

          <Cartao className="p-6">
            <h2 className="mb-1 flex items-center gap-2 font-semibold"><MessageSquarePlus size={16} className="text-suave" /> Mandar outra mensagem</h2>
            <p className="mb-3 text-xs text-suave">
              Valem para a conversa inteira, sem candidato. O texto sai pronto.
            </p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
              {MENSAGENS.map((m) => (
                <button key={m.etapa} type="button" disabled={ocupado}
                        onClick={() => preparar(m.etapa)}
                        className={cx(
                          'rounded-2xl border p-3.5 text-left transition-colors disabled:opacity-50',
                          mensagem?.etapa === m.etapa
                            ? 'border-acento/50 bg-acento/10'
                            : 'border-borda hover:border-borda-forte hover:bg-superficie-alta',
                        )}>
                  <span className="block text-sm font-medium">{m.rotulo}</span>
                  <span className="block text-xs text-suave">{m.dica}</span>
                </button>
              ))}
            </div>

            {mensagem && (
              <div className="mt-4 border-t border-borda pt-4">
                <div className="whitespace-pre-wrap rounded-2xl rounded-tl-md border border-borda bg-superficie-alta p-5 text-[15px] leading-[1.7]">
                  {mensagem.texto}
                </div>
                <Botao tamanho="g" className="mt-4 w-full" onClick={abrir} disabled={ocupado}>
                  {ocupado
                    ? <><Loader2 size={17} className="animate-spin" /> Registrando…</>
                    : <><Send size={17} /> Abrir conversa no WhatsApp</>}
                </Botao>
              </div>
            )}
          </Cartao>

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
        ) : historico.interacoes.length === 0 && historico.cliques.length === 0 ? (
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
          </ol>
        )}
      </Cartao>

      <p className="text-xs text-suave">
        Atendido por {atendente}. Nunca anote em quem a pessoa vota — nem aqui, nem em lugar nenhum.
      </p>
    </div>
  );
}

/* ── Mensagens que pertencem a um candidato ─────────────────────────────── */

/**
 * A lista sai de `contato_candidato`: quem foi declarado a ESTA pessoa. Não é
 * a chapa atual do atendente — um candidato que entrou depois não pode alcançar
 * quem autorizou sem saber dele.
 */
function PorCandidato({
  entregas, ocupado, escolhido, etapaEscolhida, aoPreparar,
}: {
  entregas: EntregaDoContato[];
  ocupado: boolean;
  escolhido: string | null;
  etapaEscolhida: EtapaMsg | null;
  aoPreparar: (etapa: EtapaMsg, candidatoId: string) => void;
}) {
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
            return (
              <div key={c.candidato_id}
                   className="flex flex-wrap items-center gap-3 rounded-2xl border border-borda p-3.5">
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
        {ITENS_KIT.map((i) => (
          <label key={i.valor}
                 className={cx('flex cursor-pointer items-center gap-3 rounded-2xl border p-3.5 transition-colors',
                   itens.includes(i.valor) ? 'border-acento/45 bg-acento/10' : 'border-borda hover:border-borda-forte')}>
            <input type="checkbox" checked={itens.includes(i.valor)} onChange={() => alternar(i.valor)}
                   className="size-5 accent-[var(--acento)]" />
            <span className="text-sm font-medium">{i.rotulo}</span>
          </label>
        ))}
      </div>

      {/* Só aparece com camiseta no pedido: perguntar o tamanho de quem pediu
          adesivo é campo que a pessoa lê, pensa e deixa em branco. */}
      {itens.includes('camiseta') && (
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
