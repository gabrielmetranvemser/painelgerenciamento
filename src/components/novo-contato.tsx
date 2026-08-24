'use client';

import { useEffect, useRef, useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronDown, Loader2, UserPlus, X } from 'lucide-react';
import { Aviso, Botao, Campo, Selecao, cx } from '@/components/ui';
import { useChipSalvo } from '@/components/chip-salvo';
import { CamposEndereco } from '@/components/campos-endereco';
import { ENDERECO_VAZIO, TAMANHOS_CAMISETA, enderecoUtilizavel, type EnderecoEstruturado } from '@/lib/cep';
import type { Chip, MotivoAdicionar, Municipio } from '@/lib/tipos-banco';
import {
  adicionarContato, carregarChapa, type CandidatoDaChapa,
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

const ITENS = [
  { valor: 'santinho', rotulo: 'Santinho' },
  { valor: 'adesivo', rotulo: 'Adesivo de carro' },
  { valor: 'camiseta', rotulo: 'Camiseta' },
];

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
  const [erro, setErro] = useState<string | null>(null);
  const [avisoKit, setAvisoKit] = useState<string | null>(null);
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

  // A chapa só é buscada quando alguém abre "Mais opções": na maioria dos
  // cadastros ninguém abre, e seria uma consulta por clique no botão flutuante.
  useEffect(() => {
    if (!expandido || chapa.length > 0) return;
    void carregarChapa().then((c) => {
      setChapa(c);
      if (c.length === 1) setCandidatoId(c[0].id);
      else setCandidatoId(c.find((x) => x.principal)?.id ?? '');
    });
  }, [expandido, chapa.length]);

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
                {ITENS.map((i) => (
                  <label key={i.valor} className={cx(
                    'flex cursor-pointer items-center gap-3 rounded-2xl border p-3 transition-colors',
                    itens.includes(i.valor) ? 'border-acento/45 bg-acento/10' : 'border-borda',
                  )}>
                    <input
                      type="checkbox" checked={itens.includes(i.valor)}
                      onChange={() => setItens((a) =>
                        a.includes(i.valor) ? a.filter((v) => v !== i.valor) : [...a, i.valor])}
                      className="size-5 accent-[var(--acento)]"
                    />
                    <span className="text-sm font-medium">{i.rotulo}</span>
                  </label>
                ))}
              </div>
            </div>

            {itens.includes('camiseta') && (
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
