'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { AlertTriangle, Check, ChevronDown, Loader2, UserPlus, X } from 'lucide-react';
import { Aviso, Botao, Campo, Selecao, cx } from '@/components/ui';
import { useChipSalvo } from '@/components/chip-salvo';
import { CamposEndereco } from '@/components/campos-endereco';
import { ENDERECO_VAZIO, TAMANHOS_CAMISETA, enderecoUtilizavel, type EnderecoEstruturado } from '@/lib/cep';
import { carregarItensKit } from '@/lib/acoes-itens-kit';
import { pedeTamanho, type ItemKit } from '@/lib/itens-kit';
import type { Chip, MotivoAdicionar, Municipio } from '@/lib/tipos-banco';
import {
  adicionarContato, carregarChapa, consultarTelefone,
  type CandidatoDaChapa, type ConsultaTelefone,
} from '@/app/[entrada]/(interno)/painel/acoes';
import { registrarPedidoKit } from '@/app/[entrada]/(interno)/painel/contatos/[id]/acoes';

/**
 * Botão flutuante: cadastrar quem chamou o atendente.
 *
 * O caso é o mais comum da operação e era o único sem lugar no sistema — a
 * pessoa manda mensagem por conta própria, o atendente responde, e aquilo não
 * existia em lugar nenhum: nem na conta do dia, nem no relatório, nem na lista
 * de quem não pode ser abordado de novo por outro atendente.
 *
 * Aberto, pede só nome e número. O resto está atrás de "Mais opções" porque
 * quem está com a conversa aberta do lado não vai preencher oito campos — e
 * cidade, kit e endereço podem ser completados depois, no perfil do contato.
 */

const RECUSA: Record<MotivoAdicionar, string> = {
  usuario_inativo: 'Sua conta está inativa. Fale com o gestor.',
  termo_nao_aceito: 'Você precisa aceitar o termo de uso antes de atender.',
  chip_nao_e_seu: 'Esse número não está no seu cadastro. Fale com o gestor.',
  chip_indisponivel: 'Seu número está pausado. Escolha outro chip ou fale com o gestor.',
  telefone_invalido: 'Confira o número.',
  numero_bloqueado:
    'Esse número pediu para sair da lista. Não dá para cadastrar por aqui — ' +
    'o gestor já foi avisado e só ele pode liberar.',
  ja_e_de_outro_atendente: 'Esse número já está com outro atendente.',
  numero_repetido: 'Esse número acabou de ser cadastrado. Recarregue a página.',
};

export function NovoContato({
  chips, municipios, rotaPainel,
}: {
  chips: Chip[];
  municipios: Municipio[];
  rotaPainel: string;
}) {
  const [aberto, setAberto] = useState(false);
  const vivos = chips.filter((c) => c.status !== 'morto');

  // Sem número vivo não há como cadastrar: o contato nasce preso a um chip.
  if (vivos.length === 0) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setAberto(true)}
        aria-label="Adicionar contato que chamou você"
        title="Adicionar contato que chamou você"
        className={cx(
          'fixed bottom-5 right-5 z-30 grid size-14 place-items-center rounded-full',
          'bg-acento text-fundo shadow-[var(--sombra-alta)] transition-transform',
          'hover:scale-105 active:scale-95',
        )}
      >
        <UserPlus size={22} />
      </button>

      {aberto && (
        <Formulario
          chips={vivos}
          municipios={municipios}
          rotaPainel={rotaPainel}
          aoFechar={() => setAberto(false)}
        />
      )}
    </>
  );
}

/* ── A folha ───────────────────────────────────────────────────────────── */

function Formulario({
  chips, municipios, rotaPainel, aoFechar,
}: {
  chips: Chip[];
  municipios: Municipio[];
  rotaPainel: string;
  aoFechar: () => void;
}) {
  const router = useRouter();
  const [nome, setNome] = useState('');
  const [telefone, setTelefone] = useState('');
  const [expandido, setExpandido] = useState(false);
  const [cidadeId, setCidadeId] = useState<number | ''>('');
  const [candidatoId, setCandidatoId] = useState<string>('');
  const [itens, setItens] = useState<string[]>([]);
  const [tamanho, setTamanho] = useState('');
  const [endereco, setEndereco] = useState<EnderecoEstruturado>(ENDERECO_VAZIO);
  const [chapa, setChapa] = useState<CandidatoDaChapa[]>([]);
  const [itensKit, setItensKit] = useState<ItemKit[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [avisoKit, setAvisoKit] = useState<string | null>(null);
  /**
   * O que o servidor sabe sobre este número — consultado enquanto a pessoa
   * digita, e não no clique.
   *
   * ⚠️ `adicionar_contato` já recusava número que é de outro atendente, mas SÓ
   * DEPOIS de o formulário inteiro ser preenchido e enviado. E dois atendentes
   * falando com o mesmo eleitor é o que vira denúncia: o aviso tem de chegar
   * antes de a conversa começar, não depois.
   */
  const [consulta, setConsulta] = useState<{ chave: string; r: ConsultaTelefone } | null>(null);
  const [consultando, setConsultando] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const primeiroCampo = useRef<HTMLInputElement>(null);

  // O chip é o mesmo que a tela de atendimento usa. Sem isso o contato nasceria
  // preso a um número diferente do que a pessoa realmente chamou.
  const [chipEscolhido, setChipEscolhido] = useState<string | null>(null);
  const chipSalvo = useChipSalvo();
  const valido = (id: string | null) => (id && chips.some((c) => c.id === id) ? id : null);
  const chipId = valido(chipEscolhido) ?? valido(chipSalvo) ?? chips[0]?.id ?? '';

  useEffect(() => { primeiroCampo.current?.focus(); }, []);

  useEffect(() => {
    const aoTeclar = (e: KeyboardEvent) => { if (e.key === 'Escape') aoFechar(); };
    window.addEventListener('keydown', aoTeclar);
    return () => window.removeEventListener('keydown', aoTeclar);
  }, [aoFechar]);

  // A chapa e os itens só são buscados quando alguém abre "Mais opções": na
  // maioria dos cadastros ninguém abre, e seriam duas consultas por clique no
  // botão flutuante.
  useEffect(() => {
    if (!expandido || itensKit.length > 0) return;
    void carregarItensKit().then(setItensKit);
  }, [expandido, itensKit.length]);

  useEffect(() => {
    if (!expandido || chapa.length > 0) return;
    void carregarChapa().then((c) => {
      setChapa(c);
      if (c.length === 1) setCandidatoId(c[0].id);
      else setCandidatoId(c.find((x) => x.principal)?.id ?? '');
    });
  }, [expandido, chapa.length]);

  // Consulta com folga depois da última tecla: sem isso é uma ida ao servidor
  // por dígito digitado.
  const digitos = telefone.replace(/\D/g, '');
  /** Só consulta com número plausível. Abaixo disso não há o que perguntar. */
  const telefonePronto = digitos.length >= 10 ? digitos : null;

  /**
   * A resposta vale só para o número que está no campo AGORA.
   *
   * Casar o resultado com a pergunta é o que substitui um `setConsulta(null)`
   * dentro do efeito — que o React trata como renderização em cascata.
   */
  const consultaAtual =
    consulta && telefonePronto && consulta.chave === telefonePronto ? consulta.r : null;

  useEffect(() => {
    if (!telefonePronto) return;

    let cancelado = false;
    const t = setTimeout(async () => {
      setConsultando(true);
      const r = await consultarTelefone(telefonePronto);
      // A resposta de um número que a pessoa já apagou não pode sobrescrever a
      // do número que ela está digitando agora — daí a `chave` junto.
      if (cancelado) return;
      setConsulta({ chave: telefonePronto, r });
      setConsultando(false);
    }, 500);

    return () => { cancelado = true; clearTimeout(t); };
  }, [telefonePronto]);

  const cidade = municipios.find((m) => m.id === cidadeId) ?? null;
  const podeEnviar = nome.trim().length >= 2 && telefone.replace(/\D/g, '').length >= 10;

  function enviar() {
    setErro(null);
    setAvisoKit(null);

    iniciar(async () => {
      const r = await adicionarContato({
        nome,
        telefone,
        chipId,
        municipioId: cidadeId === '' ? null : cidadeId,
        candidatoId: candidatoId || null,
      });

      if (!r.ok) {
        const base = RECUSA[r.motivo] ?? 'Não consegui cadastrar.';
        setErro(
          r.motivo === 'ja_e_de_outro_atendente' && r.atendente
            ? `Esse número já está com ${r.atendente}. Fale com ${r.atendente} antes de responder.`
            : r.motivo === 'telefone_invalido' && r.detalhe
              ? r.detalhe
              : base,
        );
        return;
      }

      // O pedido de kit é um segundo passo porque precisa do contato já criado.
      // Se ele falhar, o CADASTRO continua valendo — perder o contato por causa
      // do endereço seria trocar o problema grande pelo pequeno.
      if (itens.length > 0) {
        const k = await registrarPedidoKit(
          r.contato.id, endereco, itens, cidadeId === '' ? null : cidadeId, tamanho || null,
        );
        if (!k.ok) {
          // Fica na folha aberta com o aviso. Ler `avisoKit` aqui não serviria:
          // o estado só muda na próxima renderização, e este código ainda está
          // rodando com o valor antigo.
          setAvisoKit(
            'O contato foi cadastrado e já é seu, mas o pedido de kit não salvou. ' +
            'Abra o perfil dele e anote o endereço por lá.',
          );
          return;
        }
      }

      // Leva para a tela de atendimento com o contato já na mão: ele foi
      // criado em atendimento, então "Buscar contato" devolve ele mesmo.
      router.push(`${rotaPainel}?novo=${r.contato.id}`);
      router.refresh();
      aoFechar();
    });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center">
      <button
        type="button" aria-label="Fechar" onClick={aoFechar}
        className="absolute inset-0 bg-fundo/70 backdrop-blur-sm"
      />

      <div
        role="dialog" aria-modal="true" aria-label="Adicionar contato"
        className={cx(
          'relative max-h-[92vh] w-full overflow-y-auto border border-borda bg-superficie',
          'rounded-t-3xl p-5 shadow-[var(--sombra-alta)] sm:max-w-lg sm:rounded-3xl sm:p-6',
        )}
      >
        <div className="mb-4 flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-lg font-semibold tracking-tight">Adicionar contato</h2>
            <p className="mt-0.5 text-xs leading-relaxed text-suave">
              Para quem chamou você primeiro no WhatsApp. Entra como seu, já em atendimento.
            </p>
          </div>
          <button
            type="button" onClick={aoFechar} aria-label="Fechar"
            className="grid size-8 shrink-0 place-items-center rounded-full text-suave hover:bg-superficie-alta hover:text-texto"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-3">
          <Campo
            ref={primeiroCampo}
            rotulo="Nome" value={nome} maxLength={120}
            onChange={(e) => setNome(e.target.value)}
            placeholder="Cole ou escreva o nome"
          />
          <Campo
            rotulo="WhatsApp" value={telefone} type="tel" inputMode="tel" maxLength={24}
            onChange={(e) => setTelefone(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter' && podeEnviar) { e.preventDefault(); enviar(); } }}
            placeholder="(69) 99999-0000"
            dica="Pode colar do WhatsApp, com ou sem +55."
          />

          <AvisoDeDuplicado consulta={consultaAtual}
                            consultando={consultando && consultaAtual === null} />

          {chips.length > 1 && (
            <Selecao rotulo="Seu número que ela chamou" value={chipId}
                     onChange={(e) => setChipEscolhido(e.target.value)}>
              {chips.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
            </Selecao>
          )}
        </div>

        <button
          type="button"
          onClick={() => setExpandido((v) => !v)}
          className="mt-4 flex items-center gap-1.5 text-xs font-semibold text-acento"
        >
          <ChevronDown size={14} className={cx('transition-transform', expandido && 'rotate-180')} />
          {expandido ? 'Menos opções' : 'Mais opções'}
        </button>

        {expandido && (
          <div className="mt-3 space-y-4 rounded-2xl border border-borda p-4">
            <Selecao rotulo="Cidade" value={cidadeId}
                     onChange={(e) => setCidadeId(e.target.value ? Number(e.target.value) : '')}>
              <option value="">Não informou</option>
              {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
            </Selecao>

            {chapa.length > 1 && (
              <Selecao
                rotulo="Sobre qual candidato ela procurou"
                value={candidatoId}
                dica="É o que decide qual material você pode mandar para ela."
                onChange={(e) => setCandidatoId(e.target.value)}
              >
                {chapa.map((c) => <option key={c.id} value={c.id}>{c.nome}</option>)}
              </Selecao>
            )}

            <div>
              <p className="mb-2 text-[13px] font-semibold">Pediu material impresso?</p>
              <div className="space-y-2">
                {itensKit.map((i) => (
                  <label key={i.chave} className={cx(
                    'flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors',
                    itens.includes(i.chave) ? 'border-acento/45 bg-acento/10' : 'border-borda',
                  )}>
                    <input
                      type="checkbox" checked={itens.includes(i.chave)}
                      onChange={() => setItens((a) =>
                        a.includes(i.chave) ? a.filter((v) => v !== i.chave) : [...a, i.chave])}
                      className="size-5 accent-[var(--acento)]"
                    />
                    <span className="text-sm font-medium">{i.rotulo}</span>
                  </label>
                ))}
              </div>
            </div>

            {pedeTamanho(itens, itensKit) && (
              <Selecao rotulo="Tamanho da camiseta" value={tamanho}
                       onChange={(e) => setTamanho(e.target.value)}>
                <option value="">Não informou</option>
                {TAMANHOS_CAMISETA.map((t) => <option key={t} value={t}>{t}</option>)}
              </Selecao>
            )}

            {itens.length > 0 && (
              <div>
                <p className="mb-2 text-[13px] font-semibold">Endereço para entrega</p>
                <CamposEndereco
                  valor={endereco}
                  aoMudar={setEndereco}
                  cidade={cidade ? { nome: cidade.nome, uf: cidade.uf } : null}
                />
                {!enderecoUtilizavel(endereco) && (
                  <p className="mt-2 text-xs text-suave">
                    Pode deixar em branco agora e completar depois, no perfil do contato.
                  </p>
                )}
              </div>
            )}
          </div>
        )}

        {erro && <Aviso tom="erro" className="mt-4">{erro}</Aviso>}
        {avisoKit && <Aviso tom="alerta" className="mt-4">{avisoKit}</Aviso>}

        <div className="mt-5 flex gap-3">
          <Botao className="flex-1" disabled={!podeEnviar || ocupado} onClick={enviar}>
            {ocupado ? <><Loader2 size={15} className="animate-spin" /> Cadastrando…</> : 'Adicionar e atender'}
          </Botao>
          <Botao variante="neutro" onClick={aoFechar} disabled={ocupado}>Cancelar</Botao>
        </div>
      </div>
    </div>
  );
}

/* ── Esse número já é de alguém? ─────────────────────────────────────────── */

/**
 * O aviso que aparece enquanto o atendente digita o telefone.
 *
 * ⚠️ Cada caso manda a pessoa para um lugar DIFERENTE, e é por isso que não é
 * um aviso só:
 *
 *   bloqueado          não cadastre, e não responda. Quem pediu saída não pode
 *                      voltar por uma porta lateral — é multa por mensagem.
 *   é de outro colega  fale com o colega ANTES de responder. Dois atendentes
 *                      no mesmo eleitor é o que vira denúncia.
 *   é seu, já falado   não é cadastro novo: é a conversa que já existe.
 *   é seu, não falado  já está na sua fila; cadastrar de novo não faz nada.
 *   existe, sem dono   está na fila geral — vai cair para alguém.
 *
 * O verde do "número novo" existe de propósito: sem ele, a ausência de aviso
 * seria indistinguível de "a consulta não rodou".
 */
function AvisoDeDuplicado({
  consulta, consultando,
}: {
  consulta: ConsultaTelefone | null;
  consultando: boolean;
}) {
  if (consultando) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-suave">
        <Loader2 size={12} className="animate-spin" /> conferindo se esse número já está na base…
      </p>
    );
  }

  if (!consulta) return null;

  if (!consulta.ok) {
    // Telefone que nem chega a ser telefone: o campo já explica, e repetir aqui
    // seria dois vermelhos dizendo a mesma coisa.
    return null;
  }

  if (consulta.bloqueado) {
    return (
      <Aviso tom="erro" icone={<AlertTriangle size={14} />}>
        <strong>Esse número pediu para sair da lista.</strong> Não cadastre e não responda —
        mandar mensagem para quem pediu saída é multa por mensagem. Se a pessoa procurou você
        de novo por conta própria, avise o gestor: só ele pode liberar.
      </Aviso>
    );
  }

  if (!consulta.existe) {
    return (
      <p className="flex items-center gap-1.5 text-xs text-ok">
        <Check size={12} /> número novo — ninguém falou com essa pessoa ainda.
      </p>
    );
  }

  if (consulta.meu) {
    return (
      <Aviso tom="info">
        {consulta.ja_falado
          ? <>
              <strong>Essa pessoa já é sua e você já falou com ela</strong>
              {consulta.primeiro_contato_em &&
                ` em ${new Date(consulta.primeiro_contato_em).toLocaleDateString('pt-BR')}`}.
              {' '}Procure em <strong>Meus contatos</strong> em vez de cadastrar de novo — lá
              você continua a conversa e corrige o resultado.
            </>
          : <>
              <strong>Essa pessoa já está na sua fila</strong>, ainda sem conversa.
              Cadastrar de novo não muda nada: ela vai chegar em &ldquo;Buscar próximo
              contato&rdquo;.
            </>}
      </Aviso>
    );
  }

  if (consulta.atendente) {
    return (
      <Aviso tom="alerta" icone={<AlertTriangle size={14} />}>
        <strong>Esse número já está com {consulta.atendente}.</strong>{' '}
        {consulta.ja_falado
          ? `${consulta.atendente} já conversou com essa pessoa.`
          : `${consulta.atendente} ainda não falou com ela.`}
        {' '}Fale com {consulta.atendente} antes de responder — duas pessoas da campanha
        escrevendo para o mesmo eleitor é o que gera denúncia.
      </Aviso>
    );
  }

  return (
    <Aviso tom="info">
      Esse número já está na base, na fila geral, ainda sem atendente. Cadastrar por aqui traz
      ele para você.
    </Aviso>
  );
}
