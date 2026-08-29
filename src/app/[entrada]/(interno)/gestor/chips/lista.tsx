'use client';

import { useActionState, useState, useTransition } from 'react';
import { Flame, Pause, Play, Skull, SmartphoneCharging } from 'lucide-react';
import { Avatar, Aviso, Botao, Campo, Cartao, Farol, Selecao } from '@/components/ui';
import type { SaudeChip, StatusChip, TetoDoChip, Usuario } from '@/lib/tipos-banco';
import { criarChip, matarChip, mudarStatus } from './acoes';

const ROTULO_STATUS: Record<StatusChip, string> = {
  aquecendo: 'Aquecendo',
  ativo: 'Ativo',
  amarelo: 'Atenção',
  pausado: 'Pausado',
  morto: 'Morto',
};

export function GerenciarChips({
  chips, atendentes, tetos,
}: {
  chips: SaudeChip[]; atendentes: Usuario[]; tetos: TetoDoChip[];
}) {
  const porChip = new Map(tetos.map((t) => [t.chip_id, t]));
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

        {/* ⚠️ O gestor não sabia que "Aquecendo" mudava o teto. Ele configurou
            30 conversas por dia, a atendente travou em 8, e ele passou a tarde
            mexendo no campo achando que não salvava. A explicação e o botão
            precisam estar na mesma tela — e o botão já estava. */}
        <Cartao className="p-4 text-xs leading-relaxed text-suave">
          <p className="mb-1 font-medium text-texto">Aquecendo x Ativo</p>
          <strong className="text-texto">Aquecendo</strong> segue a rampa: 5 conversas no primeiro
          dia de uso, 8 no segundo, 12, 18, 25 e só então o limite cheio. Todo número entra assim,
          porque chip novo que fala com 30 desconhecidos no primeiro dia cai.{' '}
          <strong className="text-texto">Ativo</strong> segue o que está em Configuração. Marque
          ativo o número que já era usado no dia a dia antes da campanha — esse não precisa aquecer.
        </Cartao>

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

            {/* O limite de HOJE, com a origem escrita. É a resposta à pergunta
                que ficou três dias sem lugar na tela: "por que 8, se eu pus 30?" */}
            {c.status !== 'morto' && porChip.get(c.chip_id) && (
              <TetoDeHoje teto={porChip.get(c.chip_id)!} />
            )}

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
                    title={c.status === 'aquecendo'
                      ? 'Encerra a rampa: este número passa a seguir o limite de Configuração.'
                      : undefined}
                    onClick={() => iniciar(async () => { await mudarStatus(c.chip_id, 'ativo'); })}>
                    <Play size={12} />
                    {c.status === 'aquecendo' ? 'Terminar aquecimento' : 'Marcar ativo'}
                  </Botao>
                )}
                {c.status === 'ativo' && (
                  <Botao variante="neutro" tamanho="p" disabled={ocupado}
                    title="Volta o número para a rampa dos primeiros dias."
                    onClick={() => iniciar(async () => { await mudarStatus(c.chip_id, 'aquecendo'); })}>
                    <Flame size={12} /> Voltar a aquecer
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

/**
 * O limite que este número tem hoje, e de onde ele vem.
 *
 * Vem de `teto_dos_chips()` — a mesma função que a fila chama para recusar. O
 * gestor precisa poder olhar para um número e saber, sem contar dias na mão,
 * quantas conversas ele vai conseguir fazer.
 */
function TetoDeHoje({ teto }: { teto: TetoDoChip }) {
  return (
    <p className={`mt-3 border-t border-borda pt-3 text-xs leading-relaxed ${
      teto.em_rampa ? 'text-alerta' : 'text-suave'
    }`}>
      <span className="font-medium tabular-nums">
        {teto.teto} conversas hoje · {teto.intervalo_seg}s de intervalo
      </span>
      {teto.em_rampa
        ? ` — aquecendo, dia ${teto.dia_rampa} de uso. Enquanto estiver aquecendo, este número não
           chega ao limite de Configuração.`
        : ' — o limite de Configuração.'}
    </p>
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
