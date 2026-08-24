'use client';

import { useRef, useState, useTransition } from 'react';
import { Loader2, MapPin, Search } from 'lucide-react';
import { acharPorCep, acharPorRua } from '@/lib/acoes-endereco';
import type { EnderecoDoCep } from '@/lib/busca-cep';
import {
  formatarCep, mascaraCep, mesmaCidade, normalizarCep, type EnderecoEstruturado,
} from '@/lib/cep';
import { Campo, cx } from './ui';

/**
 * Endereço de entrega: CEP puxa o resto.
 *
 * Usado nas duas telas que pedem material impresso — a página pública do
 * candidato e o perfil do contato no painel. Por isso é componente e não
 * formulário: o que muda entre as duas é só quem guarda o estado.
 *
 * Três decisões que parecem detalhe e não são:
 *
 * • **Não tem complemento.** O campo existia e vinha vazio em quase todo
 *   pedido; quem precisava dele escrevia "fundos" no número. Um campo a menos
 *   é um formulário que termina.
 *
 * • **Nome, WhatsApp e cidade não se repetem aqui.** Já foram perguntados antes
 *   no formulário. A cidade chega por prop e serve para duas coisas: conferir
 *   se o CEP bate e permitir buscar pelo nome da rua.
 *
 * • **O CEP nunca é obrigatório.** Em Rondônia é comum a cidade inteira ter um
 *   CEP só, que não devolve rua nem bairro — e tem quem simplesmente não saiba.
 *   O CEP acelera; quem manda é o que está escrito nos campos.
 */

type Estado =
  | { tipo: 'parado' }
  | { tipo: 'buscando' }
  | { tipo: 'preenchido'; parcial: boolean }
  | { tipo: 'outra_cidade'; cidade: string }
  | { tipo: 'nao_encontrado' }
  | { tipo: 'servico_fora' };

export function CamposEndereco({
  valor, aoMudar, cidade, desabilitado, obrigatorio,
}: {
  valor: EnderecoEstruturado;
  aoMudar: (e: EnderecoEstruturado) => void;
  /** A cidade já escolhida no formulário. Sem ela, a busca por rua não abre. */
  cidade: { nome: string; uf: string } | null;
  desabilitado?: boolean;
  obrigatorio?: boolean;
}) {
  const [estado, setEstado] = useState<Estado>({ tipo: 'parado' });
  const [buscandoCep, iniciarCep] = useTransition();
  const [abrirBusca, setAbrirBusca] = useState(false);
  const numeroRef = useRef<HTMLInputElement>(null);
  // Guarda o último CEP consultado para o mesmo valor não ir duas vezes —
  // acontece a cada blur/refocus do campo.
  const ultimoBuscado = useRef<string | null>(null);

  function trocar(parte: Partial<EnderecoEstruturado>) {
    aoMudar({ ...valor, ...parte });
  }

  function aoDigitarCep(bruto: string) {
    const mascarado = mascaraCep(bruto);
    const digitos = normalizarCep(mascarado);
    trocar({ cep: digitos ?? (mascarado.replace(/\D/g, '') || null) });

    if (!digitos) {
      setEstado({ tipo: 'parado' });
      ultimoBuscado.current = null;
      return;
    }
    if (digitos === ultimoBuscado.current) return;
    ultimoBuscado.current = digitos;

    setEstado({ tipo: 'buscando' });
    iniciarCep(async () => {
      const r = await acharPorCep(digitos);

      if (!r.ok) {
        setEstado({ tipo: r.motivo === 'servico_fora' ? 'servico_fora' : 'nao_encontrado' });
        return;
      }

      const e = r.endereco;

      // Cidade diferente da escolhida: avisa, mas NÃO bloqueia nem troca a
      // cidade. Quem se mudou há pouco erra o CEP; quem digitou errado corrige.
      // Bloquear aqui seria impedir o cadastro por causa de um campo opcional.
      if (cidade && e.cidade && !mesmaCidade(e.cidade, cidade.nome)) {
        setEstado({ tipo: 'outra_cidade', cidade: e.cidade });
      } else {
        // CEP de cidade inteira não devolve rua nem bairro. Não é erro: é o
        // caso normal do interior, e a pessoa preenche na mão.
        setEstado({ tipo: 'preenchido', parcial: !e.rua || !e.bairro });
      }

      aoMudar({
        ...valor,
        cep: e.cep,
        rua: e.rua ?? valor.rua,
        bairro: e.bairro ?? valor.bairro,
      });

      // Rua e bairro vieram prontos: o que falta é o número. Levar o cursor
      // até lá é o que todo site de entrega faz, e economiza um toque no celular.
      if (e.rua) numeroRef.current?.focus();
    });
  }

  function usarAchado(e: EnderecoDoCep) {
    ultimoBuscado.current = e.cep;
    aoMudar({ ...valor, cep: e.cep, rua: e.rua ?? valor.rua, bairro: e.bairro ?? valor.bairro });
    setEstado({ tipo: 'preenchido', parcial: false });
    setAbrirBusca(false);
    numeroRef.current?.focus();
  }

  return (
    <div className="space-y-3">
      <div className="flex items-end gap-3">
        <div className="w-40 shrink-0">
          <Campo
            rotulo="CEP"
            name="cep"
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={9}
            disabled={desabilitado}
            placeholder="76801-000"
            value={valor.cep ? mascaraCep(valor.cep) : ''}
            onChange={(ev) => aoDigitarCep(ev.target.value)}
          />
        </div>
        <div className="min-h-[46px] flex-1 pb-3 text-xs leading-relaxed">
          {buscandoCep || estado.tipo === 'buscando' ? (
            <span className="flex items-center gap-1.5 text-suave">
              <Loader2 size={13} className="animate-spin" /> buscando…
            </span>
          ) : (
            <Recado estado={estado} />
          )}
        </div>
      </div>

      {!desabilitado && (
        <BuscaPorRua
          aberto={abrirBusca}
          aoAbrir={() => setAbrirBusca((a) => !a)}
          cidade={cidade}
          aoEscolher={usarAchado}
        />
      )}

      <Campo
        rotulo="Rua"
        name="rua"
        autoComplete="address-line1"
        maxLength={120}
        required={obrigatorio}
        disabled={desabilitado}
        placeholder="Nome da rua, avenida ou linha"
        value={valor.rua ?? ''}
        onChange={(ev) => trocar({ rua: ev.target.value })}
      />

      <div className="grid grid-cols-2 gap-3">
        <Campo
          ref={numeroRef}
          rotulo="Número"
          name="numero"
          autoComplete="address-line2"
          maxLength={20}
          required={obrigatorio}
          disabled={desabilitado}
          placeholder="123 ou S/N"
          value={valor.numero ?? ''}
          onChange={(ev) => trocar({ numero: ev.target.value })}
        />
        <Campo
          rotulo="Bairro"
          name="bairro"
          autoComplete="address-level3"
          maxLength={80}
          required={obrigatorio}
          disabled={desabilitado}
          placeholder="Centro"
          value={valor.bairro ?? ''}
          onChange={(ev) => trocar({ bairro: ev.target.value })}
        />
      </div>
    </div>
  );
}

/* ── O recado ao lado do CEP ───────────────────────────────────────────── */

function Recado({ estado }: { estado: Estado }) {
  if (estado.tipo === 'parado') {
    return <span className="text-tenue">Digite o CEP que o resto vem sozinho.</span>;
  }
  if (estado.tipo === 'preenchido') {
    return estado.parcial ? (
      <span className="text-suave">
        Esse CEP vale para a cidade toda. Escreva a rua e o bairro.
      </span>
    ) : (
      <span className="flex items-center gap-1.5 text-ok">
        <MapPin size={13} /> endereço encontrado
      </span>
    );
  }
  if (estado.tipo === 'outra_cidade') {
    return (
      <span className="text-alerta">
        Esse CEP é de {estado.cidade}. Confira o CEP ou a cidade que você escolheu.
      </span>
    );
  }
  if (estado.tipo === 'nao_encontrado') {
    return <span className="text-alerta">Não achei esse CEP. Escreva o endereço abaixo.</span>;
  }
  return <span className="text-suave">Não consegui consultar agora. Escreva o endereço abaixo.</span>;
}

/* ── Busca pelo nome da rua ────────────────────────────────────────────── */

/**
 * Para quem não sabe o CEP.
 *
 * A busca é sempre DENTRO da cidade já escolhida — é o que torna o resultado
 * curto o bastante para alguém ler, e o que faz "Rua das Flores" devolver a
 * rua certa em vez das 300 do estado.
 */
function BuscaPorRua({
  aberto, aoAbrir, cidade, aoEscolher,
}: {
  aberto: boolean;
  aoAbrir: () => void;
  cidade: { nome: string; uf: string } | null;
  aoEscolher: (e: EnderecoDoCep) => void;
}) {
  const [termo, setTermo] = useState('');
  const [achados, setAchados] = useState<EnderecoDoCep[] | null>(null);
  const [recado, setRecado] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();

  function buscar() {
    if (!cidade) return;
    setRecado(null);
    setAchados(null);
    iniciar(async () => {
      const r = await acharPorRua(cidade.uf, cidade.nome, termo);
      if (r.ok) { setAchados(r.achados); return; }
      setRecado(
        r.motivo === 'termo_curto' ? 'Escreva pelo menos 3 letras do nome da rua.'
          : r.motivo === 'nao_encontrado' ? `Não achei essa rua em ${cidade.nome}. Pode escrever o endereço na mão.`
          : 'Não consegui buscar agora. Pode escrever o endereço na mão.',
      );
    });
  }

  return (
    <div>
      <button
        type="button"
        onClick={aoAbrir}
        className="text-xs font-semibold text-acento underline-offset-4 hover:underline"
      >
        {aberto ? 'Fechar' : 'Não sei meu CEP'}
      </button>

      {aberto && (
        <div className="mt-2 rounded-2xl border border-borda bg-superficie-alta/60 p-3">
          {!cidade ? (
            <p className="text-xs text-suave">Escolha a cidade acima para eu poder buscar a rua.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-suave">
                Escreva o nome da rua. Busco em {cidade.nome}.
              </p>
              <div className="flex gap-2">
                <input
                  value={termo}
                  onChange={(e) => setTermo(e.target.value)}
                  // Enter aqui NÃO pode enviar o formulário inteiro: a pessoa
                  // está no meio do endereço, não no fim do cadastro.
                  onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); buscar(); } }}
                  maxLength={80}
                  placeholder="Ex.: das Flores"
                  className="min-w-0 flex-1 rounded-full border border-borda bg-superficie px-4 py-2 text-sm text-texto placeholder:text-tenue"
                />
                <button
                  type="button"
                  onClick={buscar}
                  disabled={ocupado}
                  className="grid size-9 shrink-0 place-items-center rounded-full border border-borda text-suave transition-colors hover:border-borda-forte hover:text-texto disabled:opacity-50"
                  aria-label="Buscar rua"
                >
                  {ocupado ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
                </button>
              </div>

              {recado && <p className="mt-2 text-xs text-alerta">{recado}</p>}

              {achados && achados.length > 0 && (
                <ul className="mt-2 max-h-56 space-y-1 overflow-y-auto">
                  {achados.map((e) => (
                    <li key={`${e.cep}-${e.rua}`}>
                      <button
                        type="button"
                        onClick={() => aoEscolher(e)}
                        className={cx(
                          'w-full rounded-xl px-3 py-2 text-left text-sm transition-colors',
                          'hover:bg-superficie-alta',
                        )}
                      >
                        <span className="block truncate font-medium">{e.rua ?? '(sem rua)'}</span>
                        <span className="block truncate text-xs text-suave">
                          {[e.bairro, formatarCep(e.cep)].filter(Boolean).join(' · ')}
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
