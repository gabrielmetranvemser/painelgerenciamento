'use client';

import { useEffect, useState } from 'react';
import { CheckCircle2, Download, RefreshCw, TriangleAlert } from 'lucide-react';
import { Aviso, BotaoLink, Cartao } from '@/components/ui';
import { VERSAO_MINIMA, estadoDaExtensao, type EstadoDaExtensao } from '@/lib/whatsapp-aba';

/**
 * Trocar a extensão antiga pela nova.
 *
 * ⚠️ A extensão não se atualiza sozinha. Ela é carregada "sem compactação",
 * direto de uma pasta na máquina de cada atendente — é o preço de não depender
 * da revisão da Chrome Web Store, que leva de dias a mais de uma semana. A
 * consequência é esta tela: toda versão nova é uma troca manual, em cada perfil
 * de cada máquina.
 *
 * ── POR QUE APARECE MESMO SEM CONFIRMAR QUE A EXTENSÃO É ANTIGA ─────────────
 *
 * A primeira versão disto só aparecia no estado `antiga`, que só é detectável
 * de DENTRO do painel lateral: a extensão anterior não declara
 * `externally_connectable`, então numa aba comum ela é indistinguível de "nunca
 * instalou". O resultado foi o relato de 31/08 — o atendente abre "Preparar
 * máquina" numa aba normal, com a extensão velha instalada, e a página não diz
 * nada sobre trocar.
 *
 * Como não dá para saber, a tela deixa de fingir que sabe. No estado `ausente`
 * ela pergunta em vez de afirmar: "já tinha instalado? então precisa trocar".
 * Uma pergunta a mais para quem nunca instalou custa uma linha de leitura; a
 * ausência do aviso para quem tem a antiga custa um dia de abas duplicadas.
 *
 * Some por completo só no estado `atual`, que é o único em que há certeza de
 * que não há nada a fazer — e aí ela confirma isso, em uma linha verde.
 */
export function TrocarExtensao({ entrada }: { entrada: string }) {
  const [estado, setEstado] = useState<EstadoDaExtensao>('verificando');

  useEffect(() => {
    let vivo = true;
    void estadoDaExtensao().then((e) => { if (vivo) setEstado(e); });
    return () => { vivo = false; };
  }, []);

  if (estado === 'verificando') return null;

  if (estado === 'atual') {
    return (
      <Cartao className="mb-6 border-ok/40 bg-ok/[0.06] p-4">
        <p className="flex items-center gap-2 text-sm font-medium text-ok">
          <CheckCircle2 size={16} />
          Sua extensão está na versão {VERSAO_MINIMA} — não precisa trocar nada.
        </p>
      </Cartao>
    );
  }

  const certeza = estado === 'antiga';

  return (
    <Cartao className={`mb-6 p-6 ${certeza ? 'border-alerta/45 bg-alerta/[0.06]' : 'border-borda'}`}>
      <h2 className={`flex items-center gap-2 font-display text-xl font-semibold tracking-tight ${
        certeza ? 'text-alerta' : ''
      }`}>
        <RefreshCw size={18} />
        {certeza ? 'Você precisa trocar a extensão' : 'Já tinha a extensão instalada?'}
      </h2>

      <p className="mt-2 text-sm leading-relaxed text-suave">
        {certeza ? (
          <>
            A sua é de uma versão anterior. Por isso o WhatsApp abre numa aba nova a cada
            conversa — a versão nova acha a aba que já está aberta e usa ela. Leva dois minutos.
          </>
        ) : (
          <>
            Se você instalou antes de hoje, ela precisa ser trocada: a versão nova ({VERSAO_MINIMA})
            usa a aba de WhatsApp que já está aberta em vez de abrir outra a cada conversa. Daqui
            eu não consigo confirmar qual você tem — a versão antiga não conversa com o painel, e
            é justamente isso que a nova resolve. Se você está instalando agora pela primeira vez,
            pode pular direto para os cinco passos abaixo.
          </>
        )}
      </p>

      <Aviso tom="alerta" className="mt-5" icone={<TriangleAlert size={16} />}>
        Extensão no Chrome é <strong>por perfil</strong>. Se você usa dois perfis (um para cada
        número), faça isto nos <strong>dois</strong> — é o engano mais comum aqui.
      </Aviso>

      {/* ⚠️ `target="_blank"`: dentro do painel lateral da extensão, o painel
          roda num iframe com `sandbox`, e o Chrome bloqueia download iniciado
          ali — em silêncio. A aba nova não herda o sandbox, então funciona
          mesmo na versão antiga, que é exatamente quem precisa baixar. */}
      <BotaoLink href={`/${entrada}/extensao`} prefetch={false} tamanho="g" className="mt-5"
                 target="_blank" rel="noopener">
        <Download size={17} /> Baixar a versão nova
      </BotaoLink>

      <div className="mt-6 grid gap-5 sm:grid-cols-2">
        <div>
          <p className="text-[13px] font-semibold">Se você lembra onde descompactou</p>
          <p className="mt-1 text-xs leading-relaxed text-suave">
            O caminho curto: troca os arquivos e recarrega.
          </p>
          <ol className="mt-3 space-y-2 text-sm">
            <Item n={1}>Descompacte o arquivo novo <strong>por cima</strong> da pasta antiga,
              substituindo tudo</Item>
            <Item n={2}>Abra <Codigo>chrome://extensions</Codigo></Item>
            <Item n={3}>Ache <strong>Painel de Atendimento</strong> e clique no ícone de{' '}
              <strong>recarregar</strong> (a setinha circular no canto do cartão)</Item>
            <Item n={4}>Confira: a versão tem que aparecer como <strong>{VERSAO_MINIMA}</strong></Item>
          </ol>
        </div>

        <div>
          <p className="text-[13px] font-semibold">Se não lembra, ou deu errado</p>
          <p className="mt-1 text-xs leading-relaxed text-suave">
            Remove a antiga e instala a nova do zero. Sempre funciona.
          </p>
          <ol className="mt-3 space-y-2 text-sm">
            <Item n={1}>Abra <Codigo>chrome://extensions</Codigo></Item>
            <Item n={2}>No cartão <strong>Painel de Atendimento</strong>, clique em{' '}
              <strong>Remover</strong> e confirme</Item>
            <Item n={3}>Descompacte o arquivo novo numa pasta que você não vá mexer depois —
              por exemplo <Codigo>Documentos/painel</Codigo></Item>
            <Item n={4}>Ligue o <strong>Modo do desenvolvedor</strong>, no canto superior direito</Item>
            <Item n={5}>Clique em <strong>Carregar sem compactação</strong> e escolha essa pasta</Item>
            <Item n={6}>Fixe o ícone na barra do Chrome</Item>
          </ol>
        </div>
      </div>

      <div className="mt-6 border-t border-borda pt-4 text-xs leading-relaxed text-suave">
        <p>
          <strong className="text-texto">O download não acontece nada?</strong> Você está com a
          versão antiga e abriu esta página pelo painel lateral. Ela bloqueia downloads, e a
          correção disso está justamente no arquivo que você quer baixar. Abra o painel numa{' '}
          <strong>aba normal do Chrome</strong> e baixe de lá — depois de trocar, o download passa
          a funcionar pela lateral também.
        </p>
        <p className="mt-2">
          <strong className="text-texto">Deu &ldquo;já existe uma extensão com este ID&rdquo;?</strong>{' '}
          É a antiga ainda carregada de outra pasta. Remova ela primeiro e tente de novo — as
          duas têm o mesmo identificador de propósito, para o painel reconhecer a sua.
        </p>
        <p className="mt-2">
          <strong className="text-texto">Para saber se deu certo:</strong> recarregue esta página.
          Se aparecer uma faixa verde no lugar desta, está tudo certo. Outra forma: deixe o
          WhatsApp Web aberto numa aba e abra uma conversa pelo painel — ele tem que usar essa
          aba, não abrir outra.
        </p>
        <p className="mt-2">
          Enquanto não trocar, o painel continua funcionando normalmente — só abrindo aba nova a
          cada contato, como antes.
        </p>
      </div>
    </Cartao>
  );
}

function Item({ n, children }: { n: number; children: React.ReactNode }) {
  return (
    <li className="flex gap-2.5 leading-relaxed">
      <span className="mt-0.5 grid size-4 shrink-0 place-items-center rounded-full bg-superficie-alta text-[9px] font-bold">
        {n}
      </span>
      <span className="min-w-0">{children}</span>
    </li>
  );
}

function Codigo({ children }: { children: React.ReactNode }) {
  return (
    <code className="rounded bg-superficie-alta px-1.5 py-0.5 font-mono text-[12px]">
      {children}
    </code>
  );
}
