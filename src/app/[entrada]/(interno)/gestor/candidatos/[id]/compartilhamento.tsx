import { Share2 } from 'lucide-react';
import { Aviso, Cartao } from '@/components/ui';
import { enderecoDaVisita } from '@/lib/dominios-candidatos';
import { versaoDaMarca } from '@/lib/marca';
import type { Candidato } from '@/lib/tipos-banco';

/**
 * Como o link deste candidato chega numa conversa de WhatsApp.
 *
 * ⚠️ Esta tela existe porque o gestor NÃO TEM como conferir isso sozinho: o
 * WhatsApp guarda a prévia que baixou e não a busca de novo, então mandar o
 * link para si mesmo mostra o que estava lá antes, não o que está agora. Ficar
 * adivinhando levou o material da campanha a circular semanas com o triângulo
 * preto do Next no lugar da logo.
 *
 * Não há nada para editar aqui de propósito. As duas imagens são desenhadas a
 * partir da logo e das cores logo ao lado — mexeu ali, mudou aqui. Um segundo
 * lugar para subir "a imagem do compartilhamento" seria mais uma coisa para
 * esquecer de atualizar quando a campanha trocar de arte.
 */
export async function ComoOLinkAparece({ candidato }: { candidato: Candidato }) {
  const c = candidato;
  const conferido = Boolean(c.dominio && c.dominio_verificado_em);

  // ⚠️ O mesmo corte das imagens: com domínio conferido, nada deste candidato
  // responde no endereço do painel — nem a prévia daqui. Não é descuido que
  // ela quebre se o domínio cair: é o primeiro lugar onde o gestor vê isso.
  const base = conferido ? `https://${c.dominio}` : (await enderecoDaVisita()) ?? '';
  const marca = (peca: 'cartao' | 'icone') =>
    `${base}/api/marca/${c.slug}/${peca}?v=${versaoDaMarca(c)}`;

  return (
    <Cartao className="p-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Share2 size={16} className="text-suave" /> No WhatsApp
      </h2>
      <p className="mb-4 text-xs leading-relaxed text-suave">
        É assim que o link aparece quando alguém cola{' '}
        <strong className="text-texto">{conferido ? c.dominio : `/${c.slug}`}</strong> numa
        conversa. A imagem e o ícone saem da logo e das cores deste candidato — troque a logo ao
        lado e eles mudam junto.
      </p>

      {/* A moldura imita o balão do WhatsApp de propósito: prévia que não se
          parece com o destino não serve para decidir se está bom. */}
      <div className="overflow-hidden rounded-2xl border border-borda bg-superficie-alta">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={marca('cartao')} alt="" width={1200} height={630} className="block aspect-[1200/630] w-full bg-superficie object-cover" />
        <div className="p-3.5">
          <p className="text-[13px] font-semibold leading-snug">Material de {c.nome_urna}</p>
          <p className="mt-0.5 text-xs leading-relaxed text-suave">
            Peça o material da campanha de {c.nome_urna} pelo WhatsApp.
          </p>
          <p className="mt-1.5 font-mono text-[11px] text-tenue">{base.replace(/^https?:\/\//, '')}</p>
        </div>
      </div>

      <div className="mt-4 flex items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={marca('icone')} alt="" width={32} height={32}
             className="size-8 shrink-0 rounded-lg" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={marca('icone')} alt="" width={16} height={16}
             className="size-4 shrink-0 rounded" />
        <p className="text-xs leading-relaxed text-suave">
          O ícone da aba do navegador, no tamanho real.
        </p>
      </div>

      {!c.foto_url && (
        <Aviso tom="alerta" className="mt-4">
          Sem logo, as duas imagens saem com o nome escrito. Suba a logo ao lado.
        </Aviso>
      )}

      {c.foto_url && (
        <p className="mt-3 text-xs leading-relaxed text-tenue">
          Logo comprida vira um borrão no ícone de 16 pixels — é o tamanho, não o desenho. Se
          quiser um ícone mais nítido, suba uma versão mais quadrada da marca.
        </p>
      )}
    </Cartao>
  );
}
