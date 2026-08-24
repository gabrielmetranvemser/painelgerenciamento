'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Check, Loader2, Siren, Undo2 } from 'lucide-react';
import { Aviso, Botao, Cartao, Pilula, Selecao, Vazio, cx } from '@/components/ui';
import { CartaoChamado } from '@/components/chamado';
import {
  MOTIVOS_CHAMADO, ROTULO_MOTIVO,
  type Alerta, type ChamadoNaLista, type MotivoChamado,
} from '@/lib/tipos-banco';
import { liberarBloqueio, resolverAlerta } from './acoes';

const ROTULO_ALERTA: Record<string, string> = {
  whatsapp_estranho: 'Atendente sinalizou WhatsApp estranho',
  chip_morto: 'Número caiu',
  optin_de_bloqueado: 'Número bloqueado tentou se cadastrar de novo',
  saida_para_revisar: 'Atendente diz que marcou "Pediu saída" por engano',
  captacao_em_excesso: 'Enxurrada de cadastros de um mesmo lugar',
  cadastro_de_bloqueado_recusado: 'Atendente tentou cadastrar número bloqueado',
  saida_corrigida: 'Um "Pediu saída" foi corrigido',
  // Alertas gravados antes de o cadastro deixar de desfazer bloqueio.
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
            Vêm do botão &ldquo;WhatsApp estranho&rdquo;, da checagem de número caído e das
            recusas do formulário público — ninguém escreveu, o sistema detectou.
          </p>
          <Cartao className="divide-y divide-borda">
            {alertas.map((a) => <LinhaAlerta key={a.id} alerta={a} />)}
          </Cartao>
        </section>
      )}
    </div>
  );
}

/**
 * Um alerta e o que dá para fazer com ele.
 *
 * Antes daqui não saía ação nenhuma: `alertas.resolvido_em` não era escrito por
 * código nenhum do sistema, então o contador do menu só crescia e a lista virava
 * um mural que ninguém lê. "Dispensar" existe para isso.
 *
 * "Liberar" só aparece em `optin_de_bloqueado`, e é o ÚNICO caminho que desfaz
 * um bloqueio no sistema inteiro. Fica atrás de uma confirmação porque a decisão
 * é irreversível pelo painel e o custo de errar é multa por mensagem.
 */
function LinhaAlerta({ alerta }: { alerta: Alerta }) {
  const router = useRouter();
  const [ocupado, iniciar] = useTransition();
  const [erro, setErro] = useState<string | null>(null);
  const [confirmando, setConfirmando] = useState(false);

  // Os dois alertas que o gestor resolve com uma decisão, não só com um "li".
  const podeLiberar =
    (alerta.tipo === 'optin_de_bloqueado' && alerta.captacao_id !== null) ||
    (alerta.tipo === 'saida_para_revisar' && alerta.contato_id !== null);

  return (
    <div className="px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <Pilula cor="alerta">{ROTULO_ALERTA[alerta.tipo] ?? alerta.tipo}</Pilula>
        <span className="text-xs text-suave">
          {new Date(alerta.criado_em).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
        </span>
        <div className="ml-auto flex items-center gap-2">
          {podeLiberar && (
            confirmando ? (
              <Botao
                variante="perigo" tamanho="p" disabled={ocupado}
                onClick={() => iniciar(async () => {
                  const r = await liberarBloqueio(alerta.id);
                  if (!r.ok) { setErro(r.erro); setConfirmando(false); return; }
                  router.refresh();
                })}
              >
                {ocupado ? <Loader2 size={12} className="animate-spin" /> : <Undo2 size={12} />}
                Confirmar: liberar o número
              </Botao>
            ) : (
              <Botao variante="neutro" tamanho="p" disabled={ocupado}
                     onClick={() => { setErro(null); setConfirmando(true); }}>
                <Undo2 size={12} /> Liberar
              </Botao>
            )
          )}
          <Botao
            variante="neutro" tamanho="p" disabled={ocupado}
            onClick={() => iniciar(async () => {
              const r = await resolverAlerta(alerta.id);
              if (!r.ok) { setErro(r.erro); return; }
              router.refresh();
            })}
          >
            {ocupado ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            Dispensar
          </Botao>
        </div>
      </div>

      <p className="mt-1.5 text-sm leading-relaxed text-suave">{alerta.detalhe ?? '—'}</p>

      {confirmando && podeLiberar && (
        <p className="mt-2 text-xs leading-relaxed text-alerta">
          {alerta.tipo === 'saida_para_revisar'
            ? 'Liberar devolve esta pessoa para a conversa, com o mesmo atendente. Confirme só se ' +
              'você acredita que foi mesmo clique errado — se ela pediu para sair de verdade, ' +
              'mandar mensagem depois disso é multa por mensagem.'
            : 'Liberar devolve esta pessoa para a fila quente. O cadastro sozinho não prova quem ' +
              'preencheu o formulário — confirme só se você souber que ela realmente voltou a ' +
              'procurar a campanha.'}
        </p>
      )}

      {erro && <Aviso tom="erro" className="mt-2">{erro}</Aviso>}
    </div>
  );
}
