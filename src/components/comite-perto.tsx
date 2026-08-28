'use client';

import { useEffect, useState } from 'react';
import { Building2, MapPin, Phone } from 'lucide-react';
import { cx } from '@/components/ui';
import { comitePerto } from '@/lib/acoes-comites';
import { enderecoDoComite, type Comite, type ComitePerto } from '@/lib/comites';
import { formatarDistancia } from '@/lib/distancia';

/**
 * "Há um comitê a X km de você."
 *
 * Aparece na hora em que a pessoa informa o endereço para receber material —
 * na página pública do candidato e na conversa com o atendente.
 *
 * ⚠️ TRÊS COISAS QUE ESTE COMPONENTE NÃO FAZ, e cada uma é deliberada:
 *
 * 1. NÃO diz distância sem ter as duas coordenadas. Em cidade pequena de
 *    Rondônia o CEP vale para o município inteiro e o serviço não devolve
 *    ponto; aí ele cai para "temos um comitê na sua cidade", sem número.
 * 2. NÃO anuncia comitê de outra cidade quando não consegue medir. Quem mora em
 *    Vilhena não pode ler "perto de você" sobre um comitê a 700 km.
 * 3. NÃO diz "a X km" sem escrever "em linha reta". A estrada em Rondônia é
 *    bem mais longa que a reta, e prometer 15 km para quem vai rodar 40 é pior
 *    do que não ter dito nada.
 *
 * A consulta de coordenada roda no SERVIDOR (a ação `comitePerto`): o eleitor
 * não fala com o serviço externo, e o IP dele não sai daqui. Mesma razão do
 * cabeçalho de `busca-cep.ts`.
 */
export function ComiteMaisPerto({
  comites, cep, municipioId, className,
}: {
  comites: readonly Comite[];
  /** O CEP que a pessoa digitou. Pode estar incompleto — aí não consulta. */
  cep: string | null;
  municipioId: number | null;
  className?: string;
}) {
  /** O resultado, junto da pergunta que o gerou. Ver o `if` lá embaixo. */
  const [perto, setPerto] = useState<(NonNullable<ComitePerto> & { chave: string }) | null>(null);

  const digitos = (cep ?? '').replace(/\D/g, '');
  const cepPronto = digitos.length === 8 ? digitos : null;
  /** O que foi perguntado. Muda quando o CEP ou a cidade muda. */
  const chave = `${cepPronto ?? ''}|${municipioId ?? ''}`;

  useEffect(() => {
    if (comites.length === 0) return;

    let cancelado = false;
    // Espera a digitação parar: sem isso é uma consulta por dígito do CEP.
    const t = setTimeout(async () => {
      const r = await comitePerto([...comites], cepPronto, municipioId);
      // A resposta de um CEP que a pessoa já apagou não pode sobrescrever a do
      // CEP que ela está digitando agora.
      if (!cancelado) setPerto(r ? { ...r, chave } : null);
    }, 400);

    return () => { cancelado = true; clearTimeout(t); };
    // `comites` é array e mudaria de identidade a cada renderização do pai;
    // o que interessa é quantos são e quais, e isso não muda dentro da tela.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chave, cepPronto, municipioId, comites.length]);

  // O resultado antigo não pode sobreviver a uma mudança de CEP ou de cidade
  // enquanto a nova consulta não chega: `chave` casa o estado com o que gerou
  // ele, e é o que substitui um `setPerto(null)` dentro do efeito — que o React
  // trata como renderização em cascata.
  if (!perto || perto.chave !== chave || comites.length === 0) return null;

  const c = perto.comite;
  const endereco = enderecoDoComite(c);

  return (
    <div className={cx(
      'flex gap-3 rounded-2xl border border-acento/30 bg-acento/[0.08] p-4',
      className,
    )}>
      <Building2 size={18} className="mt-0.5 shrink-0 text-acento" />
      <div className="min-w-0">
        <p className="text-sm font-semibold">
          {perto.criterio === 'distancia'
            ? <>Há um comitê a {formatarDistancia(perto.km)} de você</>
            : <>Temos um comitê na sua cidade</>}
        </p>
        <p className="mt-0.5 text-sm">{c.nome}</p>
        {endereco && (
          <p className="mt-0.5 flex items-start gap-1.5 text-xs leading-relaxed text-suave">
            <MapPin size={12} className="mt-0.5 shrink-0" />
            <span>{endereco}</span>
          </p>
        )}
        {c.horario && <p className="mt-0.5 text-xs text-suave">{c.horario}</p>}
        {c.telefone && (
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-suave">
            <Phone size={12} className="shrink-0" /> {c.telefone}
          </p>
        )}
        {perto.criterio === 'distancia' && (
          // Sem esta linha o número seria uma promessa que a estrada não
          // cumpre. Ver o cabeçalho.
          <p className="mt-1.5 text-xs text-suave">
            A distância é em linha reta — de carro costuma ser mais.
          </p>
        )}
      </div>
    </div>
  );
}
