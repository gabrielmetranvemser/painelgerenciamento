import Link from 'next/link';
import {
  ExternalLink, FileText, Megaphone, MonitorPlay, Newspaper, Radio,
} from 'lucide-react';
import { Cartao } from './ui';
import { ROTULO_CARGO, type CargoEleitoral, type TipoMaterial } from '@/lib/tipos-banco';

/**
 * A página que a pessoa abre quando clica no link do material.
 *
 * ⚠️ Está aqui, e não dentro da rota, porque DUAS telas a desenham: a página
 * real (`/m/{token}`, com os links rastreados e o botão de sair de verdade) e a
 * prévia do gestor (que mostra o mesmo com as peças cadastradas e não grava
 * clique nenhum).
 *
 * Se cada uma tivesse a sua cópia, elas divergiriam no primeiro ajuste — e a
 * prévia passaria a mentir, que é pior do que não existir: o gestor conferiria
 * uma página que a pessoa não vê.
 *
 * O que muda entre as duas entra por parâmetro:
 *   `pecas[].href` — na real é `/r/{token}` (conta o clique); na prévia é a URL
 *                    direta da peça, que não passa pelo contador.
 *   `saida`        — na real é o botão que retira o contato da lista; na prévia,
 *                    o mesmo texto, inerte.
 *
 * Sem `'use client'`: é desenho, não tem estado (ver CLAUDE.md §3.1).
 */

export type CandidatoDaPagina = {
  nome_urna: string;
  cargo: CargoEleitoral;
  numero: string;
  partido_sigla: string | null;
  coligacao: string | null;
  cnpj_campanha: string | null;
  responsavel_material: string | null;
  slogan: string | null;
  chamada: string | null;
  propostas: string | null;
};

export type PecaDaPagina = {
  chave: string;
  titulo: string;
  descricao: string | null;
  tipo: TipoMaterial;
  href: string;
};

const ICONE: Record<TipoMaterial, React.ReactNode> = {
  santinho: <Newspaper size={18} />,
  propostas: <FileText size={18} />,
  video: <MonitorPlay size={18} />,
  canal: <Radio size={18} />,
  site: <ExternalLink size={18} />,
  outro: <Megaphone size={18} />,
};

export function PaginaDoMaterial({
  candidato: c, pecas, saida, abrirEmNovaAba = false,
}: {
  candidato: CandidatoDaPagina;
  pecas: PecaDaPagina[];
  /** O bloco de sair da lista. É o que sustenta a defesa se alguém questionar. */
  saida: React.ReactNode;
  /**
   * Só a prévia usa. Na página real a peça abre na mesma aba, como qualquer
   * link de WhatsApp; na prévia, abrir na mesma aba tiraria o gestor do painel.
   */
  abrirEmNovaAba?: boolean;
}) {
  return (
    <>
      <Cartao className="p-7" elevado>
        <p className="text-sm text-suave">
          {ROTULO_CARGO[c.cargo]} · nº {c.numero}
          {c.partido_sigla && ` · ${c.partido_sigla}`}
        </p>
        <h1 className="mt-1 font-display text-3xl font-semibold tracking-tight">{c.nome_urna}</h1>
        {c.slogan && <p className="mt-1 text-[15px] text-suave">{c.slogan}</p>}

        {c.chamada && (
          <p className="mt-5 whitespace-pre-line text-[15px] leading-relaxed">{c.chamada}</p>
        )}

        {pecas.length > 0 ? (
          <div className="mt-6 space-y-2.5">
            {pecas.map((m) => (
              <a
                key={m.chave}
                href={m.href}
                target={abrirEmNovaAba ? '_blank' : undefined}
                rel={abrirEmNovaAba ? 'noopener' : undefined}
                className="flex items-center gap-3.5 rounded-2xl border border-borda bg-superficie-alta p-4 transition-colors hover:border-borda-forte"
              >
                <span className="shrink-0 text-suave">{ICONE[m.tipo]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block font-medium">{m.titulo}</span>
                  {m.descricao && (
                    <span className="mt-0.5 block text-sm text-suave">{m.descricao}</span>
                  )}
                </span>
                <ExternalLink size={15} className="shrink-0 text-tenue" />
              </a>
            ))}
          </div>
        ) : (
          <p className="mt-6 text-sm text-suave">
            O material desta campanha ainda não está no ar. Quem falou com você avisa assim
            que estiver.
          </p>
        )}

        {c.propostas && (
          <div className="mt-7 border-t border-borda pt-6">
            <h2 className="mb-2 text-lg font-medium">Propostas</h2>
            <p className="whitespace-pre-line text-[15px] leading-relaxed">{c.propostas}</p>
          </div>
        )}
      </Cartao>

      <div className="mt-6 space-y-4">{saida}</div>

      <div className="mt-6 space-y-2 border-t border-borda pt-6">
        {/* Identificação da propaganda. Fica na página, e não na mensagem, porque
            aqui cabe por extenso e legível. */}
        <p className="text-xs leading-relaxed text-suave">
          Propaganda eleitoral de {c.nome_urna}
          {c.partido_sigla && ` — ${c.partido_sigla}`}
          {c.coligacao && ` (${c.coligacao})`}
          {c.cnpj_campanha && ` · CNPJ ${c.cnpj_campanha}`}
          {c.responsavel_material && ` · Responsável: ${c.responsavel_material}`}
        </p>
        <p className="text-xs leading-relaxed text-suave">
          Seus dados são usados apenas para este contato de campanha e não são vendidos nem cedidos.{' '}
          <Link href="/privacidade" className="underline underline-offset-4">
            Como tratamos seus dados
          </Link>
          .
        </p>
      </div>
    </>
  );
}
