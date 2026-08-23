'use client';

import { useActionState, useState, useTransition } from 'react';
import { Pause, Play, Skull, SmartphoneCharging } from 'lucide-react';
import { Avatar, Aviso, Botao, Campo, Cartao, Farol, Selecao } from '@/components/ui';
import type { SaudeChip, StatusChip, Usuario } from '@/lib/tipos-banco';
import { criarChip, matarChip, mudarStatus } from './acoes';

const ROTULO_STATUS: Record<StatusChip, string> = {
  aquecendo: 'Aquecendo',
  ativo: 'Ativo',
  amarelo: 'Atenção',
  pausado: 'Pausado',
  morto: 'Morto',
};

export function GerenciarChips({ chips, atendentes }: { chips: SaudeChip[]; atendentes: Usuario[] }) {
  const [estado, acao] = useActionState(criarChip, null);
  const [ocupado, iniciar] = useTransition();
  const [confirmandoMorte, setConfirmandoMorte] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);

  return (
    <div className="grid gap-5 lg:grid-cols-[340px_1fr]">
      <div className="space-y-4">
        <Cartao className="p-6">
          <h2 className="mb-1 flex items-center gap-2 font-semibold"><SmartphoneCharging size={16} className="text-suave" /> Novo número</h2>
          <p className="mb-4 text-xs text-suave">
            Cada atendente trabalha com um ativo e um reserva. O reserva fica pareado e aquecido,
            sem tocar na lista.
          </p>
          <form action={acao} className="space-y-4">
            <Selecao rotulo="Atendente" name="atendente_id" required defaultValue="">
              <option value="" disabled>escolha…</option>
              {atendentes.map((a) => <option key={a.id} value={a.id}>{a.primeiro_nome}</option>)}
            </Selecao>
            <Campo rotulo="Nome do número" name="rotulo" required placeholder="Chip A" />
            <Selecao rotulo="Função" name="papel" defaultValue="ativo">
              <option value="ativo">Ativo — faz o atendimento</option>
              <option value="reserva">Reserva — só aquecendo</option>
            </Selecao>
            <Campo rotulo="Número (opcional)" name="numero" placeholder="(69) 99999-0000"
                   dica="Só para o relatório. O sistema não acessa o WhatsApp." />
            <Botao type="submit" disabled={ocupado}>Cadastrar</Botao>
          </form>
        </Cartao>

        {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}
        {aviso && <Aviso tom="alerta">{aviso}</Aviso>}

        <Cartao className="p-4 text-xs leading-relaxed text-suave">
          <p className="mb-1 font-medium text-texto">Termômetro</p>
          Vermelho em qualquer eixo — mais de 30% pedindo saída, mais de 12% de número inválido,
          mais de 80% sem resposta em 24h, ou menos de 30% clicando no link — significa pausar
          24 a 48h e trocar pelo reserva.
        </Cartao>
      </div>

      <div className="space-y-3">
        {chips.length === 0 && (
          <Cartao className="p-8 text-center text-sm text-suave">Nenhum número cadastrado.</Cartao>
        )}
        {chips.map((c) => (
          <Cartao key={c.chip_id} className="p-5">
            <div className="flex flex-wrap items-center gap-3">
              <Avatar nome={c.atendente} tamanho="p" />
              <div className="mr-auto min-w-0">
                <p className="font-semibold">
                  {c.rotulo}
                  <span className="ml-2 text-xs font-normal text-suave">
                    {c.atendente ?? 'sem dono'} · {c.papel === 'reserva' ? 'reserva' : 'ativo'}
                  </span>
                </p>
                <p className="text-xs text-suave">
                  {ROTULO_STATUS[c.status]}
                  {c.ultimas_abordagens > 0 && ` · ${c.ultimas_abordagens} abordagens recentes`}
                </p>
              </div>
              <Farol estado={c.farol} />
            </div>

            {c.ultimas_abordagens > 0 && (
              <div className="mt-3 grid grid-cols-2 gap-3 border-t border-borda pt-3 text-xs sm:grid-cols-4">
                <Indicador rotulo="Pediram saída" valor={c.pct_saida} limite={[15, 30]} />
                <Indicador rotulo="Inválidos" valor={c.pct_invalido} limite={[5, 12]} />
                <Indicador rotulo="Sem resposta 24h" valor={c.pct_sem_resposta} limite={[60, 80]} />
                <Indicador rotulo="Clicaram" valor={c.pct_clique} limite={[50, 30]} invertido />
              </div>
            )}

            {c.status !== 'morto' && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-borda pt-3">
                {c.status !== 'ativo' && (
                  <Botao variante="neutro" tamanho="p" disabled={ocupado}
                    onClick={() => iniciar(async () => { await mudarStatus(c.chip_id, 'ativo'); })}>
                    <Play size={12} /> Marcar ativo
                  </Botao>
                )}
                {c.status !== 'pausado' && (
                  <Botao variante="neutro" tamanho="p" disabled={ocupado}
                    onClick={() => iniciar(async () => { await mudarStatus(c.chip_id, 'pausado'); })}>
                    <Pause size={12} /> Pausar
                  </Botao>
                )}
                {confirmandoMorte === c.chip_id ? (
                  <>
                    <Botao variante="perigo" tamanho="p" disabled={ocupado}
                      onClick={() => iniciar(async () => {
                        const r = await matarChip(c.chip_id);
                        setConfirmandoMorte(null);
                        if (r?.contatos_perdidos) {
                          setAviso(`${c.rotulo} morto. ${r.contatos_perdidos} contato(s) em conversa foram marcados como perdidos e não voltam para a fila.`);
                        }
                      })}>
                      Confirmar: número morto
                    </Botao>
                    <Botao variante="fantasma" tamanho="p" onClick={() => setConfirmandoMorte(null)}>
                      Cancelar
                    </Botao>
                  </>
                ) : (
                  <Botao variante="perigo" tamanho="p" onClick={() => setConfirmandoMorte(c.chip_id)}>
                    <Skull size={12} /> Marcar como morto
                  </Botao>
                )}
              </div>
            )}
          </Cartao>
        ))}
      </div>
    </div>
  );
}

function Indicador({
  rotulo, valor, limite, invertido,
}: {
  rotulo: string; valor: number | null; limite: [number, number]; invertido?: boolean;
}) {
  if (valor === null) return <div><p className="text-suave">{rotulo}</p><p>—</p></div>;
  const [amarelo, vermelho] = limite;
  const ruim = invertido ? valor < vermelho : valor > vermelho;
  const atencao = invertido ? valor < amarelo : valor >= amarelo;
  const cor = ruim ? 'text-perigo' : atencao ? 'text-alerta' : 'text-ok';
  return (
    <div>
      <p className="text-suave">{rotulo}</p>
      <p className={`font-medium tabular-nums ${cor}`}>{valor}%</p>
    </div>
  );
}
