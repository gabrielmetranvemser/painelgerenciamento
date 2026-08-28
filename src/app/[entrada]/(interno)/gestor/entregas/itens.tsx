'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Check, Plus, Power, Shirt } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, Pilula, cx } from '@/components/ui';
import { alternarItemKit, salvarItemKit } from '@/lib/acoes-itens-kit';
import type { ItemKit } from '@/lib/itens-kit';

type Linha = ItemKit & { ordem: number; ativo: boolean };

/**
 * O cadastro do que a pessoa pode pedir.
 *
 * ⚠️ ESTAVA ESCRITO À MÃO EM CINCO LUGARES do código — a validação do
 * formulário público, o próprio formulário, o botão de adicionar contato, o
 * perfil do contato e o rótulo desta tela. Acrescentar "boné" era um deploy, e
 * esquecer um dos cinco era um item que aparece na tela e o servidor recusa.
 *
 * Fica aqui, dentro de Entregas, e não em Configuração: quem cadastra o item é
 * quem separa a caixa.
 */
export function CadastroDeItens({ itens }: { itens: Linha[] }) {
  const [abrindo, setAbrindo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  return (
    <Cartao className="p-6">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto font-semibold">O que a pessoa pode pedir</h2>
        {!abrindo && (
          <Botao tamanho="p" variante="neutro" onClick={() => { setErro(null); setAbrindo(true); }}>
            <Plus size={13} /> Novo item
          </Botao>
        )}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-suave">
        Vale para a página do candidato e para os dois lugares onde o atendente anota o pedido.
        Item desativado some das telas novas, mas continua legível nas entregas de quem já pediu.
      </p>

      {erro && <Aviso tom="erro" className="mb-4">{erro}</Aviso>}

      <ul className="space-y-2">
        {itens.map((i) => (
          <li key={i.chave}
              className={cx('flex flex-wrap items-center gap-3 rounded-2xl border p-3.5',
                i.ativo ? 'border-borda' : 'border-borda bg-fundo/40')}>
            <div className="mr-auto min-w-0">
              <p className={cx('flex items-center gap-2 text-sm font-semibold',
                !i.ativo && 'text-suave line-through')}>
                {i.rotulo}
                {i.pede_tamanho && (
                  <span title="Pergunta o tamanho da camiseta" className="text-suave">
                    <Shirt size={12} />
                  </span>
                )}
              </p>
              <p className="font-mono text-xs text-tenue">{i.chave}</p>
            </div>

            {!i.ativo && <Pilula>desativado</Pilula>}

            <Botao variante={i.ativo ? 'fantasma' : 'neutro'} tamanho="p" disabled={ocupado}
                   onClick={() => iniciar(async () => {
                     const r = await alternarItemKit(i.chave, !i.ativo);
                     if (r.ok) router.refresh(); else setErro(r.erro);
                   })}>
              <Power size={12} /> {i.ativo ? 'Desativar' : 'Reativar'}
            </Botao>
          </li>
        ))}
      </ul>

      {abrindo && (
        <NovoItem
          proximaOrdem={Math.max(0, ...itens.map((i) => i.ordem)) + 1}
          aoFechar={() => setAbrindo(false)}
          aoErro={setErro}
        />
      )}

      <p className="mt-4 border-t border-borda pt-4 text-xs leading-relaxed text-suave">
        Não dá para apagar um item, só desativar. A chave dele fica gravada no pedido de quem já
        pediu — apagar deixaria o relatório de entrega com um código que ninguém sabe traduzir.
      </p>
    </Cartao>
  );
}

function NovoItem({
  proximaOrdem, aoFechar, aoErro,
}: {
  proximaOrdem: number;
  aoFechar: () => void;
  aoErro: (e: string | null) => void;
}) {
  const [rotulo, setRotulo] = useState('');
  const [chave, setChave] = useState('');
  const [pedeTamanho, setPedeTamanho] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  /**
   * A chave sai do rótulo, sem acento e sem espaço.
   *
   * Ela é escrita uma vez e vale para sempre — fica gravada em
   * `captacoes.itens` de quem pedir. Deixar o gestor digitá-la à mão só criaria
   * a chance de "Boné" e "bone" virarem dois itens.
   */
  const sugerida = rotulo
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 30);

  const valor = chave || sugerida;
  const pode = rotulo.trim().length >= 2 && /^[a-z][a-z0-9_]{1,29}$/.test(valor);

  return (
    <form
      className="mt-4 space-y-3 rounded-2xl border border-borda p-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await salvarItemKit({ chave: valor, rotulo, pedeTamanho, ordem: proximaOrdem });
          if (!r.ok) { aoErro(r.erro); return; }
          aoErro(null);
          setRotulo(''); setChave(''); setPedeTamanho(false);
          aoFechar();
          router.refresh();
        });
      }}
    >
      <Campo rotulo="Nome do item" value={rotulo} maxLength={40} autoFocus
             onChange={(e) => setRotulo(e.target.value)}
             placeholder="ex.: Boné" dica="É o que a pessoa lê na tela." />

      <Campo rotulo="Código" value={valor} maxLength={30}
             onChange={(e) => setChave(e.target.value.toLowerCase())}
             placeholder="bone"
             dica="Sai do nome sozinho. Só letras minúsculas, números e _. Depois de criado não muda." />

      <label className="flex cursor-pointer items-center gap-3 rounded-2xl border border-borda p-3">
        <input type="checkbox" checked={pedeTamanho}
               onChange={(e) => setPedeTamanho(e.target.checked)}
               className="size-5 accent-[var(--acento)]" />
        <span className="text-sm">
          Perguntar o tamanho da camiseta
          <span className="block text-xs text-suave">
            Marque só em roupa. Perguntar o tamanho de quem pediu adesivo é campo que a pessoa
            lê, pensa e deixa em branco.
          </span>
        </span>
      </label>

      <div className="flex gap-2">
        <Botao type="submit" tamanho="p" disabled={!pode || ocupado}>
          <Check size={13} /> {ocupado ? 'Salvando…' : 'Criar item'}
        </Botao>
        <Botao type="button" tamanho="p" variante="neutro" disabled={ocupado} onClick={aoFechar}>
          Cancelar
        </Botao>
      </div>
    </form>
  );
}
