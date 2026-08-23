'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useRef, useState, useTransition } from 'react';
import { AlertTriangle, ImageUp, Loader2, MessageSquarePlus, Send } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, Selecao, Vazio, cx } from '@/components/ui';
import { AJUSTE_PRINT, CartaoChamado } from '@/components/chamado';
import { ErroImagem, paraWebp } from '@/lib/imagem';
import { formatarExibicao } from '@/lib/telefone';
import {
  DICA_MOTIVO, MOTIVOS_CHAMADO, ROTULO_MOTIVO,
  type Chip, type ChamadoNaLista, type MotivoChamado,
} from '@/lib/tipos-banco';
import { abrirChamado, enviarAnexo } from '@/app/[entrada]/(interno)/suporte/acoes';

export function Suporte({
  entrada, chamados, contatos, chips,
}: {
  entrada: string;
  chamados: ChamadoNaLista[];
  contatos: { id: string; nome: string | null; telefone_e164: string }[];
  chips: Chip[];
}) {
  const [novo, setNovo] = useState(chamados.length === 0);
  const router = useRouter();

  const abertos = useMemo(() => chamados.filter((c) => c.status !== 'resolvido'), [chamados]);
  const fechados = useMemo(() => chamados.filter((c) => c.status === 'resolvido'), [chamados]);

  return (
    <div className="space-y-5">
      {novo ? (
        <NovoChamado
          contatos={contatos} chips={chips}
          aoCancelar={chamados.length > 0 ? () => setNovo(false) : undefined}
          aoCriar={() => { setNovo(false); router.refresh(); }}
        />
      ) : (
        <Botao tamanho="g" onClick={() => setNovo(true)}>
          <MessageSquarePlus size={17} /> Abrir um chamado
        </Botao>
      )}

      {abertos.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-suave">Em andamento</h2>
          <div className="space-y-2.5">
            {abertos.map((c) => (
              <CartaoChamado key={c.id} chamado={c} entrada={entrada} souGestor={false}
                             aoMudar={() => router.refresh()} />
            ))}
          </div>
        </section>
      )}

      {fechados.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-medium text-suave">Resolvidos</h2>
          <div className="space-y-2.5">
            {fechados.map((c) => (
              <CartaoChamado key={c.id} chamado={c} entrada={entrada} souGestor={false}
                             aoMudar={() => router.refresh()} />
            ))}
          </div>
        </section>
      )}

      {chamados.length === 0 && !novo && (
        <Vazio>Você ainda não abriu nenhum chamado.</Vazio>
      )}
    </div>
  );
}

function NovoChamado({
  contatos, chips, aoCriar, aoCancelar,
}: {
  contatos: { id: string; nome: string | null; telefone_e164: string }[];
  chips: Chip[];
  aoCriar: () => void;
  aoCancelar?: () => void;
}) {
  const [motivo, setMotivo] = useState<MotivoChamado>('tecnico');
  const [assunto, setAssunto] = useState('');
  const [texto, setTexto] = useState('');
  const [contatoId, setContatoId] = useState('');
  const [chipId, setChipId] = useState('');
  const [prints, setPrints] = useState<{ arquivo: File; previa: string; largura: number; altura: number }[]>([]);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const entradaArquivo = useRef<HTMLInputElement>(null);

  // "Sobre um contato" e "risco jurídico" quase sempre são sobre alguém
  // específico — é o que dá ao gestor o telefone e o histórico da conversa.
  const pedeContato = motivo === 'contato' || motivo === 'juridico';

  async function escolherPrint(arquivo: File | undefined) {
    if (!arquivo) return;
    setErro(null);
    try {
      const pronta = await paraWebp(arquivo, { ...AJUSTE_PRINT, nome: 'print' });
      setPrints((atual) => [
        ...atual,
        {
          arquivo: pronta.arquivo,
          previa: URL.createObjectURL(pronta.arquivo),
          largura: pronta.largura,
          altura: pronta.altura,
        },
      ]);
    } catch (e) {
      setErro(e instanceof ErroImagem ? e.message : 'Não consegui processar a imagem.');
    } finally {
      if (entradaArquivo.current) entradaArquivo.current.value = '';
    }
  }

  function enviar() {
    setErro(null);
    iniciar(async () => {
      const r = await abrirChamado({
        motivo,
        assunto,
        texto,
        contatoId: pedeContato && contatoId ? contatoId : null,
        chipId: chipId || null,
      });
      if (!r.ok) { setErro(r.erro); return; }

      // Os prints entram depois: o anexo precisa de um chamado para pertencer.
      for (const p of prints) {
        const form = new FormData();
        form.set('arquivo', p.arquivo);
        form.set('largura', String(p.largura));
        form.set('altura', String(p.altura));
        const a = await enviarAnexo(r.dados.chamadoId, form);
        if (!a.ok) { setErro(`Chamado aberto, mas um print não subiu: ${a.erro}`); return; }
      }
      aoCriar();
    });
  }

  return (
    <Cartao className="p-6" elevado>
      <h2 className="mb-4 font-semibold">Abrir um chamado</h2>

      <p className="mb-2 text-[13px] font-semibold">O que aconteceu?</p>
      <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {MOTIVOS_CHAMADO.map((m) => (
          <button key={m} type="button" onClick={() => setMotivo(m)}
                  className={cx('rounded-2xl border p-3.5 text-left transition-colors',
                    motivo === m
                      ? m === 'juridico'
                        ? 'border-perigo/50 bg-perigo/10'
                        : 'border-acento/50 bg-acento/10'
                      : 'border-borda hover:border-borda-forte hover:bg-superficie-alta')}>
            <span className="block text-sm font-medium">{ROTULO_MOTIVO[m]}</span>
            <span className="mt-0.5 block text-xs leading-relaxed text-suave">{DICA_MOTIVO[m]}</span>
          </button>
        ))}
      </div>

      {motivo === 'juridico' && (
        <Aviso tom="alerta" className="mb-4" icone={<AlertTriangle size={16} />}>
          <strong>Pare de mandar mensagem por este número até o gestor responder.</strong>{' '}
          Anexe o print do que você recebeu e diga com quem foi. Não responda a
          quem ameaçou nem apague a conversa — ela é a sua prova.
        </Aviso>
      )}

      <div className="space-y-4">
        <Campo rotulo="Assunto" value={assunto} maxLength={140}
               onChange={(e) => setAssunto(e.target.value)}
               placeholder="Em uma linha: o que houve" />

        <label className="block">
          <span className="mb-2 block text-[13px] font-semibold">Conte o que aconteceu</span>
          <textarea value={texto} onChange={(e) => setTexto(e.target.value)} rows={5} maxLength={4000}
                    placeholder="O que você fez, o que apareceu, e o que precisa do gestor."
                    className="w-full resize-y rounded-2xl border border-borda bg-superficie-alta px-4 py-3 text-[15px] leading-relaxed placeholder:text-tenue" />
        </label>

        {pedeContato && (
          <Selecao rotulo="De qual pessoa é?" value={contatoId}
                   onChange={(e) => setContatoId(e.target.value)}
                   dica="Só aparecem os contatos que estão com você. O gestor vê o histórico junto.">
            <option value="">Não é sobre uma pessoa específica</option>
            {contatos.map((c) => (
              <option key={c.id} value={c.id}>
                {c.nome ?? 'sem nome'} — {formatarExibicao(c.telefone_e164)}
              </option>
            ))}
          </Selecao>
        )}

        {chips.length > 0 && (
          <Selecao rotulo="Por qual número?" value={chipId}
                   onChange={(e) => setChipId(e.target.value)}>
            <option value="">Não se aplica</option>
            {chips.map((c) => <option key={c.id} value={c.id}>{c.rotulo}</option>)}
          </Selecao>
        )}

        <div>
          <p className="mb-2 text-[13px] font-semibold">Prints</p>
          <input ref={entradaArquivo} type="file" accept="image/*" className="hidden"
                 onChange={(e) => void escolherPrint(e.target.files?.[0])} />

          {prints.length > 0 && (
            <div className="mb-2.5 grid gap-2.5 sm:grid-cols-3">
              {prints.map((p, i) => (
                <div key={p.previa} className="relative overflow-hidden rounded-2xl border border-borda">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.previa} alt="" className="max-h-40 w-full bg-fundo object-contain" />
                  <button type="button"
                          onClick={() => setPrints((a) => a.filter((_, k) => k !== i))}
                          className="absolute right-2 top-2 rounded-full bg-fundo/80 px-2 py-1 text-xs text-suave backdrop-blur hover:text-perigo">
                    remover
                  </button>
                </div>
              ))}
            </div>
          )}

          <Botao variante="neutro" tamanho="p" type="button" disabled={ocupado}
                 onClick={() => entradaArquivo.current?.click()}>
            <ImageUp size={13} /> {prints.length > 0 ? 'Mais um print' : 'Anexar print'}
          </Botao>

          <p className="mt-2 text-xs leading-relaxed text-suave">
            Fica guardado em local fechado, e só você e o gestor abrem.{' '}
            <strong className="text-texto">Não anexe print que mostre em quem a pessoa vota</strong> —
            isso não pode ser registrado em lugar nenhum.
          </p>
        </div>

        {erro && <Aviso tom="erro">{erro}</Aviso>}

        <div className="flex flex-wrap gap-2">
          <Botao tamanho="g" disabled={ocupado || assunto.trim().length < 3 || !texto.trim()}
                 onClick={enviar}>
            {ocupado
              ? <><Loader2 size={17} className="animate-spin" /> Enviando…</>
              : <><Send size={17} /> Enviar para o gestor</>}
          </Botao>
          {aoCancelar && (
            <Botao variante="fantasma" tamanho="g" type="button" disabled={ocupado} onClick={aoCancelar}>
              Cancelar
            </Botao>
          )}
        </div>
      </div>
    </Cartao>
  );
}
