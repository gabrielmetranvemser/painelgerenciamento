'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { ExternalLink, KeyRound, Loader2 } from 'lucide-react';
import { Aviso, Botao } from '@/components/ui';

/**
 * O socorro para quem abriu o painel na barra lateral do Chrome e a sessão não
 * sobe.
 *
 * ⚠️ Este é o modo de falha mais provável de toda a operação, e o mais cruel:
 * o atendente digita e-mail e senha, a tela pisca, e volta o formulário de
 * login. Nada explica nada. Ele tenta de novo, conclui que a senha está errada,
 * chama o gestor — e o problema não é a senha.
 *
 * A causa: no painel lateral a página de topo é `chrome-extension://`, então o
 * painel roda como conteúdo de TERCEIRO. Se o navegador bloqueia cookie de
 * terceiro (padrão que o Chrome vem ampliando), o cookie de sessão nem chega a
 * ser gravado. O login funciona; o que não sobrevive é a volta.
 *
 * Dois caminhos, nesta ordem:
 *
 *   1. `requestStorageAccess()` — a via oficial. Precisa de gesto do usuário,
 *      por isso é um botão e não algo automático. O `sandbox` do quadro na
 *      extensão já traz `allow-storage-access-by-user-activation`.
 *   2. Abrir numa aba comum, onde o painel é primeira parte e sempre funciona.
 *
 * Nada disto aparece para quem abriu o painel numa aba: o componente some
 * quando não está dentro de um quadro.
 */
/**
 * Estar ou não dentro de um quadro é fato do navegador, não estado do React —
 * por isso `useSyncExternalStore`, o mesmo mecanismo que o painel já usa para o
 * chip guardado. No servidor devolve `false`, então nada disto chega ao HTML e
 * não há divergência de hidratação.
 */
function assinarNada() {
  return () => {};
}

function estaEmQuadro(): boolean {
  try {
    return window.self !== window.top;
  } catch {
    // Não conseguir olhar para cima já significa estar dentro de um quadro.
    return true;
  }
}

export function AcessoNoPainelLateral() {
  const emQuadro = useSyncExternalStore(assinarNada, estaEmQuadro, () => false);
  // `null` enquanto não se sabe: sem isso o aviso pisca em quem está bem.
  const [temAcesso, setTemAcesso] = useState<boolean | null>(null);
  const [pedindo, setPedindo] = useState(false);
  const [negado, setNegado] = useState(false);

  useEffect(() => {
    if (!emQuadro) return;
    const suportado = typeof document.hasStorageAccess === 'function';
    // Navegador sem a API: não dá para prometer o que não se pode cumprir —
    // sobra a saída pela aba.
    (suportado ? document.hasStorageAccess() : Promise.resolve(false))
      .then((ok) => {
        setTemAcesso(ok);
        if (!suportado) setNegado(true);
      })
      .catch(() => setTemAcesso(false));
  }, [emQuadro]);

  if (!emQuadro || temAcesso !== false) return null;

  async function liberar() {
    setPedindo(true);
    try {
      await document.requestStorageAccess();
      // Recarrega para a sessão subir com o cookie já autorizado.
      window.location.reload();
    } catch {
      setNegado(true);
    } finally {
      setPedindo(false);
    }
  }

  return (
    <Aviso tom="alerta" className="mb-4">
      <div className="space-y-3">
        <p>
          <strong>Este é o painel na barra lateral.</strong> Aqui o navegador pode recusar guardar
          sua sessão — quando isso acontece, você entra e volta para esta tela sem nenhum aviso.
          Não é a sua senha.
        </p>

        {!negado && (
          <Botao variante="neutro" tamanho="p" onClick={liberar} disabled={pedindo}>
            {pedindo
              ? <><Loader2 size={13} className="animate-spin" /> Pedindo…</>
              : <><KeyRound size={13} /> Liberar acesso e entrar aqui</>}
          </Botao>
        )}

        <p className="text-xs leading-relaxed">
          {negado
            ? 'Este navegador não liberou. Use a aba comum — funciona sempre:'
            : 'Se não funcionar, use a aba comum — funciona sempre:'}{' '}
          <a
            href={typeof window === 'undefined' ? '#' : window.location.href}
            target="_blank"
            rel="noopener"
            className="inline-flex items-center gap-1 underline underline-offset-2"
          >
            abrir o painel em uma aba <ExternalLink size={11} />
          </a>
        </p>
      </div>
    </Aviso>
  );
}
