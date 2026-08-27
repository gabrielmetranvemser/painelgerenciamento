import { ArrowRight } from 'lucide-react';
import { Cartao } from './ui';

/**
 * "Onde isso aparece para a pessoa?"
 *
 * ⚠️ Esta pergunta chegou depois de a operação já estar montada, e ela é o
 * sintoma de um buraco de explicação, não de funcionalidade: o gestor cadastra
 * santinho, site e canal no perfil do candidato, abre a página pública dele
 * para conferir — e não encontra nada. Conclui que quebrou.
 *
 * Não quebrou. A página pública é onde a pessoa PEDE; o material só existe
 * depois do "pode", dentro de uma conversa que um atendente abriu. Entre o
 * cadastro e a entrega há uma pessoa, sempre, e é isso que mantém a operação
 * como "conversa entre pessoas" em vez de disparo em massa.
 *
 * Fica num arquivo SEM `'use client'` de propósito: é texto, não tem estado, e
 * assim tanto tela de servidor quanto de cliente importa (ver CLAUDE.md §3.1).
 */

const PASSOS = [
  {
    titulo: 'A pessoa pede',
    texto: 'Ela se cadastra na página pública do candidato, ou já estava numa lista importada. Nesse momento ela NÃO recebe nada — a página só diz que a equipe vai falar com ela.',
  },
  {
    titulo: 'Um atendente chama',
    texto: 'O contato entra na fila de quem atende este candidato. O atendente manda a primeira mensagem — o pedido de permissão — pelo WhatsApp dele, na mão. Nada sai daqui sozinho.',
  },
  {
    titulo: 'Ela autoriza',
    texto: 'Respondeu que pode, o atendente marca "Autorizou" e o botão "Mandar material" libera no painel dele.',
  },
  {
    titulo: 'Aí sim ela recebe',
    texto: 'Chega UM link no WhatsApp dela. Ele abre uma página só dela, com todas as peças ativas deste candidato, a identificação da propaganda com CNPJ e o botão de sair da lista.',
  },
];

export function ComoOMaterialChega() {
  return (
    <Cartao className="p-6">
      <h3 className="mb-1 text-sm font-semibold">Onde isso aparece para a pessoa</h3>
      <p className="mb-5 text-xs leading-relaxed text-suave">
        As peças cadastradas aqui não aparecem na página pública do candidato. Lá é onde a pessoa
        <strong className="text-texto"> pede</strong>; o material chega depois, e por outro
        caminho:
      </p>

      <ol className="space-y-3.5">
        {PASSOS.map((p, i) => (
          <li key={p.titulo} className="flex gap-3.5">
            <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-full border border-borda bg-superficie-alta font-display text-xs font-semibold text-suave">
              {i + 1}
            </span>
            <div className="min-w-0">
              <p className="text-sm font-semibold">{p.titulo}</p>
              <p className="mt-0.5 text-xs leading-relaxed text-suave">{p.texto}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="mt-5 space-y-2 border-t border-borda pt-4 text-xs leading-relaxed text-suave">
        <p className="flex gap-2">
          <ArrowRight size={13} className="mt-0.5 shrink-0 text-tenue" />
          <span>
            Uma página em vez de quatro links soltos porque nela cabe o que a mensagem não
            comporta: a identificação legal e o botão de sair. E porque{' '}
            <strong className="text-texto">cada peça tem link próprio</strong> — dá para saber se
            a pessoa abriu o santinho ou o vídeo, não só que &ldquo;clicou no material&rdquo;.
          </span>
        </p>
        <p className="flex gap-2">
          <ArrowRight size={13} className="mt-0.5 shrink-0 text-tenue" />
          <span>
            <strong className="text-alerta">Não abra o link de um contato para testar.</strong> O
            sistema só descarta a pré-visualização automática do WhatsApp; você abrindo no
            navegador conta como clique de verdade, e o clique é a métrica mais confiável que a
            campanha tem.
          </span>
        </p>
      </div>
    </Cartao>
  );
}
