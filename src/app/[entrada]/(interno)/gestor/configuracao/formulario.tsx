'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import Link from 'next/link';
import { Flame } from 'lucide-react';
import { rotas } from '@/lib/links-internos';
import { Aviso, Botao, Campo, Cartao } from '@/components/ui';
import type { Config, DiaBloqueado, SaudeChip, TetoDoChip } from '@/lib/tipos-banco';
import { adicionarDiaBloqueado, removerDiaBloqueado, salvarConfig } from './acoes';

function Salvar() {
  const { pending } = useFormStatus();
  return <Botao type="submit" tamanho="g" disabled={pending}>{pending ? 'Salvando…' : 'Salvar'}</Botao>;
}

function Bloco({ titulo, dica, children }: { titulo: string; dica?: string; children: React.ReactNode }) {
  return (
    <Cartao className="p-5">
      <h2 className="font-semibold">{titulo}</h2>
      {dica && <p className="mb-4 mt-0.5 text-xs text-suave">{dica}</p>}
      <div className={dica ? '' : 'mt-4'}>{children}</div>
    </Cartao>
  );
}

/**
 * Aqui mora só o que vale para TODA a operação.
 *
 * Nome, cargo, número, materiais e página de cada candidatura ficam em
 * Gestor → Candidatos, e em nenhum outro lugar. Já existiu uma cópia disso
 * nesta tela, e o resultado foi a página pública anunciando um candidato
 * enquanto o atendente mandava material de outro.
 */
export function FormularioConfig({
  config, dias, chips, tetos, entrada,
}: {
  config: Config; dias: DiaBloqueado[]; chips: SaudeChip[]; tetos: TetoDoChip[]; entrada: string;
}) {
  const [estado, acao] = useActionState(salvarConfig, null);

  return (
    <div className="space-y-5">
      <Aviso tom="info">
        Candidato, número, materiais e a página pública de cada candidatura ficam em{' '}
        <Link href={rotas(entrada).gestorCandidatos} className="underline underline-offset-4">
          Candidatos
        </Link>
        . Esta tela é só o que vale para a operação inteira.
      </Aviso>

      <form action={acao} className="space-y-5">
        {/*
          ⚠️ `key` no `atualizado_em`: quando a ação termina, a página é
          renderizada de novo com a linha que ficou no banco, e a chave nova
          remonta os campos com esses valores. Sem isso, o que ficava na tela
          era o que a pessoa digitou — indistinguível de um salvamento que
          falhou em silêncio, que foi exatamente a leitura que o gestor fez.
        */}
        <CamposRitmo key={config.atualizado_em} config={config} />

        <RitmoQueEstaValendo chips={chips} tetos={tetos} teto={config.teto_diario}
                             entrada={entrada} />

        <Bloco titulo="Termo de uso do atendente"
               dica="Cada atendente precisa aceitar antes de entrar na fila. O aceite fica gravado com data e hora.">
          <textarea name="termo_texto" rows={12} defaultValue={config.termo_texto}
                    className="w-full resize-y rounded-lg border border-borda bg-superficie p-3 font-mono text-xs" />
          <div className="mt-4">
            <Campo rotulo="Contato para questões de dados (LGPD)" name="responsavel_dados"
                   defaultValue={config.responsavel_dados}
                   placeholder="e-mail ou telefone que aparece na página de privacidade" />
          </div>
        </Bloco>

        {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}
        {estado?.ok && (
          <Aviso tom="ok">
            <p className="font-medium">Configuração salva.</p>
            {/* Os números vêm da leitura de volta do banco. É a diferença entre
                "mandei salvar" e "está salvo". */}
            <p className="mt-1 text-sm">
              Está gravado: {estado.gravado.teto_diario} conversas por dia,{' '}
              {estado.gravado.intervalo_seg}s de intervalo,{' '}
              {estado.gravado.lease_minutos} min de reserva, das{' '}
              {estado.gravado.hora_inicio}h às {estado.gravado.hora_fim}h.
            </p>
          </Aviso>
        )}
        <Salvar />
      </form>

      <DiasBloqueados dias={dias} />
    </div>
  );
}

/**
 * Os campos de ritmo, isolados para poderem ser remontados a cada gravação.
 *
 * O estado local existe só para o aviso aparecer enquanto a pessoa digita.
 * Quem grava continua sendo o formulário, pelo `name` de cada campo.
 */
function CamposRitmo({ config }: { config: Config }) {
  const [inicio, setInicio] = useState(config.hora_inicio);
  const [fim, setFim] = useState(config.hora_fim);
  const [intervalo, setIntervalo] = useState(config.intervalo_seg);

  /**
   * ⚠️ Estes três campos desligam proteções, e desligavam em silêncio.
   *
   * `hora_inicio: 0` com `hora_fim: 24` abre a operação a noite inteira, e
   * `intervalo: 0` tira o espaçamento entre abordagens — os dois padrões que o
   * WhatsApp lê como disparo, e o segundo é a trava que existe para o número do
   * atendente não cair. Nenhum dos dois é proibido: o gestor pode ter motivo. O
   * que não pode é mudar por engano e descobrir pelo chip morto.
   */
  const madrugada = inicio <= 5 || fim >= 23;
  const semIntervalo = intervalo < 30;

  return (
    <Bloco titulo="Ritmo da operação"
           dica="Vale para todo número que já saiu do aquecimento. Quem ainda está aquecendo segue a rampa, que é mais apertada — o quadro abaixo mostra quem é quem.">
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Campo rotulo="Conversas por dia" name="teto_diario" type="number" min={1} max={200}
               defaultValue={config.teto_diario} />
        <Campo rotulo="Intervalo (segundos)" name="intervalo_seg" type="number" min={0} max={3600}
               value={intervalo} onChange={(e) => setIntervalo(Number(e.target.value))} />
        <Campo rotulo="Começa às" name="hora_inicio" type="number" min={0} max={23}
               value={inicio} onChange={(e) => setInicio(Number(e.target.value))} />
        <Campo rotulo="Termina às" name="hora_fim" type="number" min={1} max={24}
               value={fim} onChange={(e) => setFim(Number(e.target.value))} />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Campo rotulo="Fuso horário" name="timezone" defaultValue={config.timezone}
               dica="Rondônia é America/Porto_Velho (UTC−4). Errar aqui desloca o horário inteiro." />
        <Campo rotulo="Minutos que o contato fica reservado" name="lease_minutos" type="number"
               min={1} max={240} defaultValue={config.lease_minutos}
               dica="Depois disso, volta para a fila se ninguém falou com a pessoa." />
      </div>

      {/* ⚠️ O TETO AVISA POR PADRÃO, e este interruptor é o que devolve a
          escolha a quem responde pela campanha. Ele fica AQUI, colado no campo
          "Conversas por dia", porque a pergunta que ele responde é justamente
          "e se o atendente passar?" — em qualquer outro lugar da tela seria
          uma configuração que ninguém acha. */}
      <label className="mt-4 flex cursor-pointer items-start gap-3 rounded-2xl border border-borda bg-superficie-alta p-4">
        <input type="checkbox" name="teto_bloqueia" defaultChecked={config.teto_bloqueia}
               className="mt-0.5 size-4 shrink-0 accent-[var(--acento)]" />
        <span className="min-w-0">
          <span className="block text-[13px] font-semibold">
            Travar o atendente ao chegar no limite do dia
          </span>
          <span className="mt-1 block text-xs leading-relaxed text-suave">
            Desmarcado (o padrão), o limite vira um <strong>aviso grande e vermelho</strong> na
            tela do atendente, e ele decide se continua. Marcado, o painel recusa a conversa e não
            tem como seguir.
            <br />
            O teto é risco de operação: no pior caso o WhatsApp derruba um número e a campanha
            troca pelo reserva. As travas que existem por lei — quem pediu saída, dia da eleição,
            termo não aceito — continuam recusando de qualquer jeito, e este campo não as
            alcança.
          </span>
        </span>
      </label>

      {(madrugada || semIntervalo) && (
        <Aviso tom="alerta" className="mt-4">
          <p className="font-medium">Isto desliga uma proteção do número.</p>
          <ul className="mt-1.5 space-y-1 text-sm">
            {madrugada && (
              <li>
                Atender das {inicio}h às {fim}h inclui horário em que ninguém espera ser
                procurado. Mensagem de campanha de madrugada é o tipo de coisa que vira
                denúncia — e o tipo de coisa que faz a pessoa bloquear o número.
              </li>
            )}
            {semIntervalo && (
              <li>
                Intervalo de {intervalo}s entre abordagens é praticamente nenhum. É o espaçamento
                que impede o mesmo número de parecer disparo — a rampa dos primeiros dias ainda
                segura o pior caso, mas depois dela não sobra proteção.
              </li>
            )}
          </ul>
          <p className="mt-1.5 text-sm">
            Dá para salvar assim. Só não dá para dizer depois que ninguém avisou.
          </p>
        </Aviso>
      )}
    </Bloco>
  );
}

/**
 * O que está valendo AGORA, número por número.
 *
 * ⚠️ Este quadro é a resposta a um dia inteiro perdido. O gestor configurou 30
 * conversas por dia, a atendente continuou travando em 8, e ele mexeu no campo
 * três vezes achando que não gravava. Gravava: o 8 vinha da rampa de
 * aquecimento do número dela, e não existia lugar nenhum na tela onde isso
 * pudesse ser lido.
 *
 * Os números saem de `teto_dos_chips()`, no banco — a mesma função que a fila
 * consulta para recusar. Recalcular a rampa aqui em JavaScript criaria duas
 * verdades, e a que apareceria na tela seria a que não manda.
 */
function RitmoQueEstaValendo({
  chips, tetos, teto, entrada,
}: {
  chips: SaudeChip[]; tetos: TetoDoChip[]; teto: number; entrada: string;
}) {
  const porChip = new Map(tetos.map((t) => [t.chip_id, t]));
  const vivos = chips.filter((c) => c.status !== 'morto');
  const aquecendo = vivos.filter((c) => porChip.get(c.chip_id)?.em_rampa);

  if (vivos.length === 0) return null;

  return (
    <Bloco titulo="O que está valendo agora"
           dica="O limite de cada número é este. Se ele for menor que o de cima, é porque o número ainda está aquecendo.">
      {aquecendo.length === 0 ? (
        <p className="text-sm text-suave">
          Nenhum número em aquecimento. Todos seguem as {teto} conversas por dia configuradas
          acima.
        </p>
      ) : (
        <>
          <Aviso tom="alerta" icone={<Flame size={16} />}>
            {aquecendo.length === 1
              ? 'Um número ainda está aquecendo e por isso faz menos conversas que o configurado.'
              : `${aquecendo.length} números ainda estão aquecendo e por isso fazem menos conversas que o configurado.`}{' '}
            A rampa termina quando você marcar o número como <strong>ativo</strong> em{' '}
            <Link href={rotas(entrada).gestorChips} className="underline underline-offset-4">
              Números
            </Link>
            . Faça isso quando o número já vinha sendo usado no dia a dia — chip comprado para a
            campanha precisa dos primeiros dias devagar, senão cai.
          </Aviso>

          <ul className="mt-4 divide-y divide-borda border-t border-borda">
            {vivos.map((c) => {
              const t = porChip.get(c.chip_id);
              if (!t) return null;
              return (
                <li key={c.chip_id} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2.5 text-sm">
                  <span className="font-medium">{c.rotulo}</span>
                  <span className="text-xs text-suave">{c.atendente ?? 'sem dono'}</span>
                  <span className="ml-auto tabular-nums">
                    {t.teto} por dia · {t.intervalo_seg}s
                  </span>
                  <span className={`w-full text-xs sm:w-auto ${t.em_rampa ? 'text-alerta' : 'text-suave'}`}>
                    {t.em_rampa ? `aquecendo — dia ${t.dia_rampa}` : 'segue a configuração'}
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </Bloco>
  );
}

function DiasBloqueados({ dias }: { dias: DiaBloqueado[] }) {
  const [data, setData] = useState('');
  const [motivo, setMotivo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  return (
    <Bloco titulo="Dias em que não se fala com ninguém"
           dica="Dia da eleição, e o segundo turno se houver. Nesses dias a fila não entrega contato nenhum.">
      <div className="flex flex-wrap items-end gap-3">
        <div className="w-44">
          <Campo rotulo="Data" type="date" value={data} onChange={(e) => setData(e.target.value)} />
        </div>
        <div className="min-w-48 flex-1">
          <Campo rotulo="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)}
                 placeholder="Eleição — 1º turno" />
        </div>
        <Botao disabled={!data || ocupado}
          onClick={() => iniciar(async () => {
            const r = await adicionarDiaBloqueado(data, motivo);
            if (r.ok) { setData(''); setMotivo(''); setErro(null); } else setErro(r.erro);
          })}>
          Bloquear
        </Botao>
      </div>

      {erro && <Aviso tom="erro" className="mt-3">{erro}</Aviso>}

      {dias.length > 0 && (
        <ul className="mt-4 divide-y divide-borda border-t border-borda">
          {dias.map((d) => (
            <li key={d.data} className="flex items-center gap-3 py-2.5">
              <span className="text-sm font-medium tabular-nums">
                {new Date(`${d.data}T12:00:00`).toLocaleDateString('pt-BR')}
              </span>
              <span className="mr-auto text-sm text-suave">{d.motivo}</span>
              <button className="text-xs text-suave hover:text-perigo" disabled={ocupado}
                      onClick={() => iniciar(async () => { await removerDiaBloqueado(d.data); })}>
                remover
              </button>
            </li>
          ))}
        </ul>
      )}
    </Bloco>
  );
}
