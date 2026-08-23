'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { Siren } from 'lucide-react';
import { Cartao, Pilula, Selecao, Vazio, cx } from '@/components/ui';
import { CartaoChamado } from '@/components/chamado';
import {
  MOTIVOS_CHAMADO, ROTULO_MOTIVO,
  type Alerta, type ChamadoNaLista, type MotivoChamado,
} from '@/lib/tipos-banco';

const ROTULO_ALERTA: Record<string, string> = {
  whatsapp_estranho: 'Atendente sinalizou WhatsApp estranho',
  chip_morto: 'Número caiu',
  bloqueio_removido_por_optin: 'Número bloqueado voltou por cadastro próprio',
};

const RECORTES = [
  { chave: 'atencao', rotulo: 'Precisam de você' },
  { chave: 'abertos', rotulo: 'Em aberto' },
  { chave: 'todos', rotulo: 'Todos' },
  { chave: 'resolvidos', rotulo: 'Resolvidos' },
] as const;

type Recorte = (typeof RECORTES)[number]['chave'];

function passa(c: ChamadoNaLista, r: Recorte) {
  switch (r) {
    // Risco jurídico entra aqui mesmo já respondido: enquanto não for
    // resolvido, é a coisa mais cara da lista para esquecer.
    case 'atencao':    return c.status !== 'resolvido' && (c.espera_gestor === true || c.motivo === 'juridico');
    case 'abertos':    return c.status !== 'resolvido';
    case 'resolvidos': return c.status === 'resolvido';
    default:           return true;
  }
}

/** Jurídico primeiro, depois o mais antigo sem resposta: quem espera há mais tempo. */
function ordenar(a: ChamadoNaLista, b: ChamadoNaLista) {
  const peso = (c: ChamadoNaLista) =>
    (c.status === 'resolvido' ? 2 : 0) + (c.motivo === 'juridico' ? -1 : 0);
  const d = peso(a) - peso(b);
  return d !== 0 ? d : a.criado_em.localeCompare(b.criado_em);
}

export function PainelSuporte({
  entrada, chamados, alertas,
}: {
  entrada: string;
  chamados: ChamadoNaLista[];
  alertas: Alerta[];
}) {
  const [recorte, setRecorte] = useState<Recorte>('atencao');
  const [motivo, setMotivo] = useState<MotivoChamado | ''>('');
  const router = useRouter();

  const visiveis = useMemo(
    () => chamados.filter((c) => passa(c, recorte) && (!motivo || c.motivo === motivo)).sort(ordenar),
    [chamados, recorte, motivo],
  );

  const contagem = (r: Recorte) => chamados.filter((c) => passa(c, r)).length;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-1.5">
        {RECORTES.map((r) => (
          <button key={r.chave} type="button" onClick={() => setRecorte(r.chave)}
                  className={cx('rounded-full px-3.5 py-2 text-sm font-medium transition-colors',
                    recorte === r.chave ? 'bg-texto text-fundo' : 'text-suave hover:bg-superficie-alta hover:text-texto')}>
            {r.rotulo} <span className="tabular-nums opacity-60">{contagem(r.chave)}</span>
          </button>
        ))}

        <Selecao compacto className="ml-auto" value={motivo}
                 onChange={(e) => setMotivo(e.target.value as MotivoChamado | '')}
                 aria-label="Filtrar por motivo">
          <option value="">Todos os motivos</option>
          {MOTIVOS_CHAMADO.map((m) => (
            <option key={m} value={m}>{ROTULO_MOTIVO[m]}</option>
          ))}
        </Selecao>
      </div>

      {visiveis.length === 0 ? (
        <Vazio icone={<Siren size={20} />}>
          {recorte === 'atencao'
            ? 'Nada esperando por você. Quando um atendente escrever, aparece aqui.'
            : 'Nenhum chamado com esses filtros.'}
        </Vazio>
      ) : (
        <div className="space-y-2.5">
          {visiveis.map((c) => (
            <CartaoChamado key={c.id} chamado={c} entrada={entrada} souGestor
                           aoMudar={() => router.refresh()} />
          ))}
        </div>
      )}

      {alertas.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-suave">Alertas do sistema</h2>
          <p className="mb-2 text-xs text-suave">
            Vêm do botão &ldquo;WhatsApp estranho&rdquo; e da checagem de número caído — ninguém
            escreveu, o sistema detectou.
          </p>
          <Cartao className="divide-y divide-borda">
            {alertas.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <Pilula cor="alerta">{ROTULO_ALERTA[a.tipo] ?? a.tipo}</Pilula>
                <span className="mr-auto min-w-0 truncate text-sm text-suave">{a.detalhe ?? '—'}</span>
                <span className="text-xs text-suave">
                  {new Date(a.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                </span>
              </div>
            ))}
          </Cartao>
        </section>
      )}
    </div>
  );
}
