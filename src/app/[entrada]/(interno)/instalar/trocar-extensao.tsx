'use client';

import { useEffect, useState } from 'react';
import { Download, RefreshCw, TriangleAlert } from 'lucide-react';
import { Aviso, BotaoLink, Cartao } from '@/components/ui';
import { estadoDaExtensao, type EstadoDaExtensao } from '@/lib/whatsapp-aba';

/**
 * Trocar a extensão antiga pela nova.
 *
 * ⚠️ A extensão não se atualiza sozinha. Ela é carregada "sem compactação",
 * direto de uma pasta na máquina de cada atendente — é o preço de não depender
 * da revisão da Chrome Web Store, que leva de dias a mais de uma semana. A
 * consequência é esta tela: toda versão nova é uma troca manual, em cada perfil
 * de cada máquina.
 *
 * Só aparece para quem TEM a versão antiga. Quem nunca instalou vê os cinco
 * passos normais logo abaixo; quem já está na nova não vê nada, porque não há
 * nada a fazer.
 *
 * Os dois caminhos existem de propósito. O curto resolve em trinta segundos e
 * funciona na maioria dos casos; o longo é o que sempre funciona, inclusive
 * quando a pessoa não lembra onde descompactou da primeira vez.
 */
export function TrocarExtensao({ entrada }: { entrada: string }) {
  const [estado, setEstado] = useState<EstadoDaExtensao>('verificando');

  useEffect(() => {
    let vivo = true;
    void estadoDaExtensao().then((e) => { if (vivo) setEstado(e); });
    return () => { vivo = false; };
  }, []);

  if (estado !== 'antiga') return null;

  return (
    <Cartao className="mb-6 border-alerta/45 bg-alerta/[0.06] p-6">
      <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight text-alerta">
        <RefreshCw size={18} /> Você precisa trocar a extensão
      </h2>
      <p className="mt-2 text-sm leading-relaxed text-suave">
        A sua é de uma versão anterior. Por isso o WhatsApp abre numa aba nova a cada conversa —
        a versão nova acha a aba que já está aberta e usa ela. Leva dois minutos.
      </p>

      <Aviso tom="alerta" className="mt-5" icone={<TriangleAlert size={16} />}>
        Extensão no Chrome é <strong>por perfil</strong>. Se você usa dois perfis (um para cada
        número), faça isto nos <strong>dois</strong> — é o engano mais comum aqui.
      </Aviso>

      <BotaoLink href={`/${entrada}/extensao`} prefetch={false} tamanho="g" className="mt-5">
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
            <Item n={4}>Confira: a versão tem que aparecer como <strong>1.1.0</strong></Item>
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

      <div className="mt-6 border-t border-alerta/25 pt-4 text-xs leading-relaxed text-suave">
        <p>
          <strong className="text-texto">Deu &ldquo;já existe uma extensão com este ID&rdquo;?</strong>{' '}
          É a antiga ainda carregada de outra pasta. Remova ela primeiro e tente de novo — as
          duas têm o mesmo identificador de propósito, para o painel reconhecer a sua.
        </p>
        <p className="mt-2">
          <strong className="text-texto">Para saber se deu certo:</strong> deixe o WhatsApp Web
          aberto numa aba, abra uma conversa pelo painel e veja se ele usou essa aba em vez de
          abrir outra. Este aviso também some sozinho quando você recarregar o painel.
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
