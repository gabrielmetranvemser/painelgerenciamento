'use client';

import { useActionState, useEffect, useState } from 'react';
import { useFormStatus } from 'react-dom';
import { Aviso, Botao, BotaoLink, Campo, Selecao, cx } from '@/components/ui';
import { CamposEndereco } from '@/components/campos-endereco';
import { ComiteMaisPerto } from '@/components/comite-perto';
import type { Comite } from '@/lib/comites';
import { ENDERECO_VAZIO, TAMANHOS_CAMISETA, type EnderecoEstruturado } from '@/lib/cep';
import { pedeTamanho, type ItemKit } from '@/lib/itens-kit';
import type { Municipio } from '@/lib/tipos-banco';
import { cadastrar } from './acoes';

/** Segundos até levar a pessoa ao WhatsApp. Curto o bastante para ela não sair
 *  da página, longo o bastante para ela ler que deu certo. */
const SEGUNDOS_ATE_O_WHATSAPP = 4;

/**
 * O fim do cadastro.
 *
 * ⚠️ Quando há número de recepção, a pessoa é levada ao WhatsApp com o texto já
 * escrito — e é ELA quem aperta enviar. O sistema não manda nada: a mensagem
 * sai do aparelho dela para a campanha. É entrada, não saída, e é o que mantém
 * esta operação longe da definição de disparo automático.
 *
 * A contagem é visível e cancelável de propósito. Redirecionamento automático
 * sem aviso é comportamento de página duvidosa, e aqui a pessoa acabou de
 * entregar telefone e endereço: ver o que vai acontecer, e poder não ir, é o
 * mínimo. Quem cancela não perde nada — o cadastro já está gravado e alguém da
 * equipe fala com ela do mesmo jeito.
 */
function Obrigado({ nome, whatsapp }: { nome: string; whatsapp: string | null }) {
  const [faltam, setFaltam] = useState(SEGUNDOS_ATE_O_WHATSAPP);
  const [cancelado, setCancelado] = useState(false);

  useEffect(() => {
    if (!whatsapp || cancelado) return;
    if (faltam <= 0) {
      window.location.assign(whatsapp);
      return;
    }
    const t = setTimeout(() => setFaltam((n) => n - 1), 1000);
    return () => clearTimeout(t);
  }, [whatsapp, cancelado, faltam]);

  if (!whatsapp || cancelado) {
    return (
      <Aviso tom="ok" className="text-base">
        <p className="font-medium">Obrigado, {nome}!</p>
        <p className="mt-1">
          Em breve alguém da equipe fala com você pelo WhatsApp e manda o material.
          Se mudar de ideia, é só pedir para sair na própria conversa.
        </p>
      </Aviso>
    );
  }

  return (
    <Aviso tom="ok" className="text-base">
      <p className="font-medium">Obrigado, {nome}!</p>
      <p className="mt-1">
        Vamos abrir uma conversa no WhatsApp com a equipe. A mensagem já vai escrita —
        é só você enviar.
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {/* Link de verdade, e não um botão com onClick: assim a pessoa vê o
            destino antes de tocar, consegue abrir noutra aba e o endereço
            existe no HTML — que é o que permite conferir o que foi montado sem
            precisar seguir o redirecionamento. */}
        <BotaoLink href={whatsapp}>Abrir o WhatsApp</BotaoLink>
        <span aria-live="polite" className="text-sm opacity-80">
          abrindo em {faltam}s
        </span>
      </div>

      <button
        type="button"
        onClick={() => setCancelado(true)}
        className="mt-3 text-sm underline underline-offset-4 opacity-70 hover:opacity-100"
      >
        Prefiro não abrir agora
      </button>
    </Aviso>
  );
}

function BotaoEnviar() {
  const { pending } = useFormStatus();
  return (
    <Botao type="submit" tamanho="g" className="w-full" disabled={pending}>
      {pending ? 'Enviando…' : 'Quero receber o material'}
    </Botao>
  );
}

export function FormularioCandidato({
  slug, aceite, municipios, itensKit, comites,
}: {
  slug: string;
  /** A MESMA frase que o servidor grava como prova. Ver src/lib/consentimento.ts. */
  aceite: string;
  municipios: Municipio[];
  /**
   * O que a pessoa pode pedir. Vem do cadastro (`itens_kit`), e não de uma
   * lista escrita aqui: acrescentar "boné" era um deploy, e esquecer um dos
   * cinco lugares onde a lista estava copiada era um item que aparece na tela
   * e o servidor recusa.
   */
  itensKit: readonly ItemKit[];
  /** Onde a pessoa pode buscar material perto de casa. Pode estar vazio. */
  comites: readonly Comite[];
}) {
  const [estado, acao] = useActionState(cadastrar, null);
  const [querImpresso, setQuerImpresso] = useState(false);
  const [cidadeId, setCidadeId] = useState<number | ''>('');
  const [itens, setItens] = useState<string[]>([]);
  const [endereco, setEndereco] = useState<EnderecoEstruturado>(ENDERECO_VAZIO);

  const cidade = municipios.find((m) => m.id === cidadeId) ?? null;

  if (estado?.ok) {
    return <Obrigado nome={estado.nome} whatsapp={estado.whatsapp} />;
  }

  return (
    <form action={acao} className="space-y-4">
      <input type="hidden" name="slug" value={slug} />

      {/* Armadilha para robô. Não é `type="hidden"` de propósito: script bom
          ignora campo escondido por tipo, mas preenche campo de texto comum.
          `aria-hidden` + `tabIndex={-1}` tiram do leitor de tela e do Tab, então
          nenhuma pessoa — nem quem navega por teclado — chega até ele. */}
      <div aria-hidden className="absolute left-[-9999px] top-0 h-0 w-0 overflow-hidden">
        <label>
          Apelido
          <input type="text" name="apelido" tabIndex={-1} autoComplete="off" />
        </label>
      </div>

      <Campo rotulo="Seu nome" name="nome" required autoComplete="name" placeholder="Nome e sobrenome" />
      <Campo
        rotulo="Seu WhatsApp"
        name="telefone"
        type="tel"
        required
        autoComplete="tel"
        placeholder="(69) 99999-0000"
        dica="Com DDD. Precisa ser um celular com WhatsApp."
      />

      {/* A cidade é estado do React, e não só um <select> solto, porque o bloco
          de endereço depende dela: é ela que confere o CEP e limita a busca por
          nome de rua. Perguntar de novo lá embaixo seria perguntar duas vezes. */}
      <Selecao
        rotulo="Sua cidade"
        name="municipio_id"
        required
        value={cidadeId}
        onChange={(e) => setCidadeId(e.target.value ? Number(e.target.value) : '')}
      >
        <option value="" disabled>Escolha…</option>
        {municipios.map((m) => (
          <option key={m.id} value={m.id}>{m.nome}</option>
        ))}
      </Selecao>

      {/* O impresso é opcional e fica fechado: formulário curto converte mais, e
          a maioria só quer o material digital. */}
      <div className="rounded-2xl border border-borda">
        <label className="flex cursor-pointer items-center gap-3 p-4">
          <input
            type="checkbox"
            checked={querImpresso}
            onChange={(e) => setQuerImpresso(e.target.checked)}
            className="size-5 accent-[var(--acento)]"
          />
          <span className="text-sm font-medium">Quero também material impresso</span>
        </label>

        <div className={cx('space-y-4 border-t border-borda p-4', querImpresso ? 'block' : 'hidden')}>
          <div className="space-y-3">
            {itensKit.map((i) => (
              <label key={i.chave} className="flex cursor-pointer items-center gap-3">
                <input
                  type="checkbox" name="itens" value={i.chave} disabled={!querImpresso}
                  checked={itens.includes(i.chave)}
                  onChange={(e) => setItens((a) =>
                    e.target.checked ? [...a, i.chave] : a.filter((v) => v !== i.chave))}
                  className="size-5 accent-[var(--acento)]"
                />
                <span className="text-sm">{i.rotulo}</span>
              </label>
            ))}
          </div>

          {pedeTamanho(itens, itensKit) && (
            <Selecao rotulo="Tamanho da camiseta" name="tamanho_camiseta" disabled={!querImpresso}
                     defaultValue="">
              <option value="">Escolha…</option>
              {TAMANHOS_CAMISETA.map((t) => <option key={t} value={t}>{t}</option>)}
            </Selecao>
          )}

          {/* Nome, WhatsApp e cidade já foram perguntados acima — aqui só entra
              o que falta para achar a casa. Sem complemento: vinha vazio em
              quase todo pedido. */}
          <div>
            <p className="mb-2 text-[13px] font-semibold">Endereço para entrega</p>
            <CamposEndereco
              valor={endereco}
              aoMudar={setEndereco}
              cidade={cidade ? { nome: cidade.nome, uf: cidade.uf } : null}
              desabilitado={!querImpresso}
              obrigatorio={querImpresso && itens.length > 0}
            />

            {/* Aparece assim que o CEP fica completo. Para quem mora perto,
                buscar no comitê chega antes da entrega — e para a campanha é
                uma peça a menos para rodar. */}
            {querImpresso && (
              <ComiteMaisPerto
                comites={comites}
                cep={endereco.cep}
                municipioId={cidadeId === '' ? null : cidadeId}
                className="mt-3"
              />
            )}
          </div>
        </div>
      </div>

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-borda bg-superficie-alta p-5">
        <input type="checkbox" name="aceite" required className="mt-0.5 size-5 shrink-0 accent-[var(--acento)]" />
        <span className="text-sm leading-relaxed">{aceite}</span>
      </label>

      {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}

      <BotaoEnviar />
    </form>
  );
}
