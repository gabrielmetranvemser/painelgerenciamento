'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState, useTransition } from 'react';
import { Check, MessageSquarePlus, Plus, Power, X } from 'lucide-react';
import { Aviso, AreaTexto, Botao, Campo, Cartao, Pilula, cx } from '@/components/ui';
import { ehGrave, validarModelo, VARIAVEIS_CONHECIDAS } from '@/lib/mensagem';
import type { ModeloLivre } from '@/lib/tipos-banco';
import { alternarModeloLivre, salvarModeloLivre } from './livres';

/**
 * As mensagens que o gestor escreve, fora das sete etapas.
 *
 * São para o que a operação usa e que não é nenhuma delas — "temos carreata no
 * sábado", "o material acabou, chega terça". Aparecem no perfil do contato, no
 * bloco "Mandar outra mensagem", junto das etapas fixas.
 *
 * ⚠️ NÃO TÊM VARIAÇÃO. A rotação de variação por chip existe para o WhatsApp
 * não ver a MESMA frase saindo do mesmo número trinta vezes seguidas — o que é
 * o padrão da abordagem em massa, não o de um recado pontual.
 */
export function MensagensDoGestor({ modelos }: { modelos: ModeloLivre[] }) {
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  return (
    <Cartao className="p-6">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto flex items-center gap-2 font-semibold">
          <MessageSquarePlus size={16} className="text-suave" /> Suas mensagens
        </h2>
        {!criando && (
          <Botao tamanho="p" variante="neutro"
                 onClick={() => { setErro(null); setEditando(null); setCriando(true); }}>
            <Plus size={13} /> Nova mensagem
          </Botao>
        )}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-suave">
        Textos seus, fora das sete etapas acima. Aparecem para o atendente no perfil do contato,
        em &ldquo;Mandar outra mensagem&rdquo;. Não substituem a Permissão nem o Material — só
        acrescentam.
      </p>

      {erro && <Aviso tom="erro" className="mb-4">{erro}</Aviso>}

      {modelos.length === 0 && !criando ? (
        <p className="text-sm text-suave">Nenhuma mensagem sua ainda.</p>
      ) : (
        <ul className="space-y-2">
          {modelos.map((m) => (
            <li key={m.id}>
              {editando === m.id ? (
                <Editor modelo={m} proximaOrdem={m.ordem}
                        aoFechar={() => setEditando(null)} aoErro={setErro} />
              ) : (
                <div className={cx('rounded-2xl border p-3.5',
                  m.ativo ? 'border-borda' : 'border-borda bg-fundo/40')}>
                  <div className="flex flex-wrap items-center gap-3">
                    <div className="mr-auto min-w-0">
                      <p className={cx('text-sm font-semibold',
                        !m.ativo && 'text-suave line-through')}>
                        {m.nome}
                      </p>
                      {m.dica && <p className="text-xs text-suave">{m.dica}</p>}
                    </div>

                    {m.e_abordagem
                      ? (
                        <span title="Respeita o intervalo entre mensagens">
                          <Pilula cor="alerta">conta o intervalo</Pilula>
                        </span>
                      )
                      : (
                        <span title="Resposta a quem acabou de escrever: não espera o intervalo">
                          <Pilula>resposta</Pilula>
                        </span>
                      )}
                    {!m.ativo && <Pilula>desativada</Pilula>}

                    <Botao tamanho="p" variante="neutro" disabled={ocupado}
                           onClick={() => { setErro(null); setCriando(false); setEditando(m.id); }}>
                      Editar
                    </Botao>
                    <Botao tamanho="p" variante="fantasma" disabled={ocupado}
                           onClick={() => iniciar(async () => {
                             const r = await alternarModeloLivre(m.id, !m.ativo);
                             if (r.ok) router.refresh(); else setErro(r.erro);
                           })}>
                      <Power size={12} /> {m.ativo ? 'Desativar' : 'Reativar'}
                    </Botao>
                  </div>
                  <p className="mt-2.5 whitespace-pre-wrap rounded-xl border border-borda bg-superficie-alta p-3 text-xs leading-relaxed text-suave">
                    {m.texto}
                  </p>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {criando && (
        <div className="mt-3">
          <Editor
            modelo={null}
            proximaOrdem={Math.max(0, ...modelos.map((m) => m.ordem)) + 1}
            aoFechar={() => setCriando(false)} aoErro={setErro}
          />
        </div>
      )}

      <p className="mt-4 border-t border-borda pt-4 text-xs leading-relaxed text-suave">
        Não dá para apagar, só desativar: o histórico de cada contato aponta para a mensagem que
        foi enviada, e apagar deixaria lá um envio que ninguém consegue mais ler.
      </p>
    </Cartao>
  );
}

function Editor({
  modelo, proximaOrdem, aoFechar, aoErro,
}: {
  modelo: ModeloLivre | null;
  proximaOrdem: number;
  aoFechar: () => void;
  aoErro: (e: string | null) => void;
}) {
  const [nome, setNome] = useState(modelo?.nome ?? '');
  const [dica, setDica] = useState(modelo?.dica ?? '');
  const [texto, setTexto] = useState(modelo?.texto ?? '');
  const [eAbordagem, setEAbordagem] = useState(modelo?.e_abordagem ?? true);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  // Mesma validação das etapas fixas. Para `livre` sobram as regras que valem
  // para qualquer texto: não pode ser vazio, não pode usar variável inexistente
  // (essas duas impedem salvar), e o aviso de linhas demais.
  const problemas = useMemo(() => validarModelo('livre', texto), [texto]);
  const impede = problemas.some((p) => p.nivel === 'impede');

  return (
    <form
      className="space-y-3 rounded-2xl border border-borda p-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await salvarModeloLivre({
            id: modelo?.id, nome, dica: dica || null, texto,
            eAbordagem, ordem: modelo?.ordem ?? proximaOrdem,
          });
          if (!r.ok) { aoErro(r.erro); return; }
          aoErro(null); aoFechar(); router.refresh();
        });
      }}
    >
      <Campo rotulo="Nome" value={nome} maxLength={60} autoFocus
             onChange={(e) => setNome(e.target.value)}
             placeholder="ex.: Carreata de sábado"
             dica="É o que o atendente lê no botão." />

      <Campo rotulo="Explicação (opcional)" value={dica} maxLength={120}
             onChange={(e) => setDica(e.target.value)}
             placeholder="quando a pessoa pergunta da agenda"
             dica="A linha embaixo do botão. Diz QUANDO usar." />

      <AreaTexto rotulo="Texto" value={texto} rows={5}
                 onChange={(e) => setTexto(e.target.value)}
                 dica={`Variáveis: ${VARIAVEIS_CONHECIDAS.map((v) => `{{${v}}}`).join(', ')}`} />

      {problemas.length > 0 && (
        <ul className="space-y-1">
          {problemas.map((p) => (
            <li key={p.codigo}
                className={cx('text-xs leading-relaxed',
                  ehGrave(p) ? 'text-perigo' : 'text-alerta')}>
              {p.mensagem}
            </li>
          ))}
        </ul>
      )}

      <label className="flex cursor-pointer items-start gap-3 rounded-2xl border border-borda p-3">
        <input type="checkbox" checked={eAbordagem}
               onChange={(e) => setEAbordagem(e.target.checked)}
               className="mt-0.5 size-5 shrink-0 accent-[var(--acento)]" />
        <span className="text-sm">
          Conta como abordagem
          <span className="block text-xs leading-relaxed text-suave">
            Marcado, ela respeita o intervalo entre mensagens — é o padrão, e é o que protege o
            número do atendente. Desmarque só quando o texto for RESPOSTA a quem acabou de
            escrever: fazer o atendente esperar para responder é o que faz ele parecer robô.
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <Botao type="submit" tamanho="p" disabled={impede || nome.trim().length < 2 || ocupado}>
          <Check size={13} /> {ocupado ? 'Salvando…' : 'Salvar'}
        </Botao>
        <Botao type="button" tamanho="p" variante="neutro" disabled={ocupado} onClick={aoFechar}>
          <X size={13} /> Cancelar
        </Botao>
      </div>
    </form>
  );
}
