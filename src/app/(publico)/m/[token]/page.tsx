import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import {
  ExternalLink, FileText, Megaphone, MonitorPlay, Newspaper, Radio,
} from 'lucide-react';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { Aviso, Cartao } from '@/components/ui';
import { ROTULO_CARGO, type CargoEleitoral, type TipoMaterial } from '@/lib/tipos-banco';
import { Descadastro } from './descadastro';

// Página pessoal, uma por contato: nunca deve ser indexada.
export const metadata: Metadata = {
  title: 'Material da campanha',
  robots: { index: false, follow: false },
};
export const dynamic = 'force-dynamic';

type Pagina = {
  ok: boolean;
  motivo?: string;
  contato_id: string;
  descadastrado: boolean;
  candidato: {
    nome_urna: string; cargo: CargoEleitoral; numero: string;
    partido_sigla: string | null; coligacao: string | null;
    cnpj_campanha: string | null; responsavel_material: string | null;
    foto_url: string | null; cor_tema: string | null;
    slogan: string | null; chamada: string | null; propostas: string | null;
    ativo: boolean;
  };
  materiais: { titulo: string; descricao: string | null; tipo: TipoMaterial; token: string }[];
};

const ICONE: Record<TipoMaterial, React.ReactNode> = {
  santinho: <Newspaper size={18} />,
  propostas: <FileText size={18} />,
  video: <MonitorPlay size={18} />,
  canal: <Radio size={18} />,
  site: <ExternalLink size={18} />,
  outro: <Megaphone size={18} />,
};

/**
 * A página do material.
 *
 * É para cá que o {{link}} da mensagem aponta — um link só, em vez de despejar
 * quatro URLs cruas no WhatsApp. Aqui cabe o que a mensagem não comporta: a
 * identificação da propaganda, o CNPJ e o botão de sair, que é o que sustenta
 * a defesa se alguém questionar.
 *
 * Cada peça abre por /r/{token} próprio, então continua dando para saber o que
 * a pessoa abriu de verdade — e não só que "clicou no material".
 */
export default async function PaginaMaterial({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const supabase = criarClienteAdmin();

  const { data } = await supabase.rpc('pagina_material', { p_token: token });
  const p = data as Pagina | null;
  if (!p?.ok) notFound();

  const c = p.candidato;

  return (
    <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10 sm:px-6">
      {p.descadastrado ? (
        <Aviso tom="ok" className="text-base">
          Seu contato já foi retirado da lista. Não vamos mais falar com você, e o número é
          apagado em até 48 horas.
        </Aviso>
      ) : (
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

            {p.materiais.length > 0 ? (
              <div className="mt-6 space-y-2.5">
                {p.materiais.map((m) => (
                  <a
                    key={m.token}
                    href={`/r/${m.token}`}
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

          <div className="mt-6 space-y-4">
            <Descadastro token={token} />
          </div>
        </>
      )}

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
    </main>
  );
}
