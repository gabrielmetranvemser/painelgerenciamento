'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Aviso, Botao, Campo, Cartao } from '@/components/ui';
import type { Config, DiaBloqueado, Destino } from '@/lib/tipos-banco';
import {
  adicionarDiaBloqueado, removerDiaBloqueado, salvarConfig, salvarDestino,
} from './acoes';

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

export function FormularioConfig({
  config, dias, destinos,
}: {
  config: Config; dias: DiaBloqueado[]; destinos: Destino[];
}) {
  const [estado, acao] = useActionState(salvarConfig, null);

  return (
    <div className="space-y-5">
      <form action={acao} className="space-y-5">
        <Bloco titulo="A campanha" dica="Alimenta as variáveis {{candidato}}, {{cargo}} e {{numero}} das mensagens.">
          <div className="grid gap-4 sm:grid-cols-3">
            <Campo rotulo="Candidato" name="candidato" defaultValue={config.candidato} placeholder="Nome de urna" />
            <Campo rotulo="Cargo" name="cargo" defaultValue={config.cargo} placeholder="deputado federal" />
            <Campo rotulo="Número" name="numero" defaultValue={config.numero} placeholder="12345" />
          </div>
        </Bloco>

        <Bloco titulo="Ritmo da operação"
               dica="A rampa de aquecimento pode ser mais restritiva que isto nos primeiros dias de cada número. O sistema sempre usa o limite mais apertado dos dois.">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Campo rotulo="Conversas por dia" name="teto_diario" type="number" min={1} max={200}
                   defaultValue={config.teto_diario} />
            <Campo rotulo="Intervalo (segundos)" name="intervalo_seg" type="number" min={0} max={3600}
                   defaultValue={config.intervalo_seg} />
            <Campo rotulo="Começa às" name="hora_inicio" type="number" min={0} max={23}
                   defaultValue={config.hora_inicio} />
            <Campo rotulo="Termina às" name="hora_fim" type="number" min={1} max={24}
                   defaultValue={config.hora_fim} />
          </div>
          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            <Campo rotulo="Fuso horário" name="timezone" defaultValue={config.timezone}
                   dica="Rondônia é America/Porto_Velho (UTC−4). Errar aqui desloca o horário inteiro." />
            <Campo rotulo="Minutos que o contato fica reservado" name="lease_minutos" type="number"
                   min={1} max={240} defaultValue={config.lease_minutos}
                   dica="Depois disso, volta para a fila se ninguém falou com a pessoa." />
          </div>
        </Bloco>

        <Bloco titulo="Página do material" dica="É o que a pessoa vê ao abrir o link que recebeu.">
          <Campo rotulo="Título" name="material_titulo" defaultValue={config.material_titulo} />
          <label className="mt-4 block">
            <span className="mb-1.5 block text-sm font-medium">Texto</span>
            <textarea name="material_texto" rows={6} defaultValue={config.material_texto}
                      className="w-full resize-y rounded-lg border border-borda bg-superficie p-3 text-sm" />
          </label>
          <label className="mt-4 flex items-center gap-2">
            <input type="checkbox" name="kit_ativo" defaultChecked={config.kit_ativo}
                   className="size-4 accent-[var(--acento)]" />
            <span className="text-sm">Página do kit no ar (/kit)</span>
          </label>
        </Bloco>

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
        {estado?.ok && <Aviso tom="ok">Configuração salva.</Aviso>}
        <Salvar />
      </form>

      <DiasBloqueados dias={dias} />
      <Destinos destinos={destinos} />
    </div>
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

function Destinos({ destinos }: { destinos: Destino[] }) {
  return (
    <Bloco titulo="Para onde os links levam"
           dica="Você troca o destino sem invalidar os links já enviados. Use /m/{token} para a nossa página, que tem descadastro e aviso de privacidade.">
      <div className="space-y-4">
        {destinos.map((d) => <LinhaDestino key={d.id} destino={d} />)}
      </div>
    </Bloco>
  );
}

function LinhaDestino({ destino }: { destino: Destino }) {
  const [url, setUrl] = useState(destino.url);
  const [erro, setErro] = useState<string | null>(null);
  const [salvo, setSalvo] = useState(false);
  const [ocupado, iniciar] = useTransition();

  return (
    <div>
      <div className="flex flex-wrap items-end gap-3">
        <div className="min-w-64 flex-1">
          <Campo rotulo={destino.nome} value={url}
                 onChange={(e) => { setUrl(e.target.value); setSalvo(false); }} />
        </div>
        <Botao disabled={url === destino.url || ocupado}
          onClick={() => iniciar(async () => {
            const r = await salvarDestino(destino.chave, url);
            if (r.ok) { setSalvo(true); setErro(null); } else setErro(r.erro);
          })}>
          Salvar
        </Botao>
        {salvo && <span className="pb-3 text-xs text-ok">salvo ✓</span>}
      </div>
      {erro && <Aviso tom="erro" className="mt-2">{erro}</Aviso>}
    </div>
  );
}
