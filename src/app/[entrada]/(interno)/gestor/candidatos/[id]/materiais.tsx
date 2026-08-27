'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { ExternalLink, FileText, Megaphone, Plus, Radio, Trash2, Video } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, Selecao, cx } from '@/components/ui';
import { ComoOMaterialChega } from '@/components/como-o-material-chega';
import type { Material, TipoMaterial } from '@/lib/tipos-banco';
import { adicionarMaterial, alternarMaterial, removerMaterial } from '../acoes';

const TIPOS: { valor: TipoMaterial; rotulo: string; icone: React.ReactNode }[] = [
  { valor: 'santinho', rotulo: 'Santinho', icone: <FileText size={14} /> },
  { valor: 'propostas', rotulo: 'Propostas', icone: <Megaphone size={14} /> },
  { valor: 'video', rotulo: 'Vídeo', icone: <Video size={14} /> },
  { valor: 'canal', rotulo: 'Canal do WhatsApp', icone: <Radio size={14} /> },
  { valor: 'site', rotulo: 'Site', icone: <ExternalLink size={14} /> },
  { valor: 'outro', rotulo: 'Outro', icone: <FileText size={14} /> },
];

export function Materiais({
  candidatoId, materiais,
}: {
  candidatoId: string;
  materiais: Material[];
}) {
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();
  const temCanal = materiais.some((m) => m.tipo === 'canal' && m.ativo);

  function enviar(form: FormData) {
    iniciar(async () => {
      const r = await adicionarMaterial(candidatoId, form);
      setErro(r.ok ? null : r.erro);
      if (r.ok) {
        (document.getElementById('form-material') as HTMLFormElement)?.reset();
        router.refresh();
      }
    });
  }

  return (
    <section className="space-y-4">
      <h2 className="text-[13px] font-semibold uppercase tracking-[0.08em] text-suave">
        Materiais
      </h2>

      <Cartao className="p-6">
        <p className="mb-4 text-xs leading-relaxed text-suave">
          Cada peça ganha um link rastreado próprio, então o relatório mostra o que a pessoa
          realmente abriu — e não só que &ldquo;clicou no material&rdquo;.
        </p>
        <form id="form-material" action={enviar} className="space-y-4">
          <Campo rotulo="Nome da peça" name="titulo" required placeholder="Santinho, Propostas, Vídeo…" />
          <Campo rotulo="Link" name="url" type="url" required placeholder="https://…" />
          <Selecao rotulo="Tipo" name="tipo" defaultValue="santinho">
            {TIPOS.map((t) => <option key={t.valor} value={t.valor}>{t.rotulo}</option>)}
          </Selecao>
          {erro && <Aviso tom="erro">{erro}</Aviso>}
          <Botao type="submit" disabled={ocupado}>
            <Plus size={14} /> Adicionar peça
          </Botao>
        </form>
      </Cartao>

      {/* A pergunta que sempre chega depois de cadastrar a primeira peça: "e
          onde isso aparece?". Fica AQUI, embaixo do formulário, porque é aqui
          que ela nasce. */}
      <ComoOMaterialChega />

      {!temCanal && (
        <Aviso tom="alerta" icone={<Radio size={16} />}>
          Sem peça do tipo <strong>Canal do WhatsApp</strong>. É ela que o convite ao canal usa —
          e entrar no canal é o que faz o contato sobreviver à queda de um número.
        </Aviso>
      )}

      {materiais.length > 0 && (
        <Cartao className="divide-y divide-borda overflow-hidden">
          {materiais.map((m) => (
            <div key={m.id} className={cx('flex items-center gap-3 px-5 py-3.5', !m.ativo && 'opacity-50')}>
              <span className="text-suave">
                {TIPOS.find((t) => t.valor === m.tipo)?.icone}
              </span>
              <div className="mr-auto min-w-0">
                <p className="truncate text-sm font-semibold">{m.titulo}</p>
                <p className="truncate font-mono text-[11px] text-suave">{m.url}</p>
              </div>
              <button type="button" disabled={ocupado}
                      className="text-xs text-suave hover:text-texto"
                      onClick={() => iniciar(async () => { await alternarMaterial(m.id, !m.ativo); router.refresh(); })}>
                {m.ativo ? 'desativar' : 'reativar'}
              </button>
              <button type="button" disabled={ocupado} title="Apagar"
                      className="text-suave hover:text-perigo"
                      onClick={() => iniciar(async () => {
                        const r = await removerMaterial(m.id);
                        if (r.ok) router.refresh(); else setErro(r.erro);
                      })}>
                <Trash2 size={14} />
              </button>
            </div>
          ))}
        </Cartao>
      )}
    </section>
  );
}
