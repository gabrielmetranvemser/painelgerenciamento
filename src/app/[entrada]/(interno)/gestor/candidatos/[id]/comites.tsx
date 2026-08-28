'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { Building2, Check, MapPin, Plus, Power, Trash2, X } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, Pilula, Selecao, cx } from '@/components/ui';
import { alternarComite, removerComite, salvarComite } from '@/lib/acoes-comites';
import { enderecoDoComite, type Comite } from '@/lib/comites';
import { formatarCep, mascaraCep } from '@/lib/cep';
import type { Municipio } from '@/lib/tipos-banco';

type Linha = Comite & { ativo: boolean; observacao: string | null };

/**
 * Os comitês de uma candidatura.
 *
 * ⚠️ A COORDENADA É O PONTO DELICADO. É ela que permite dizer "há um comitê a
 * 3 km de você" na hora em que a pessoa informa o endereço — e ela tem dois
 * caminhos:
 *
 *   1. sai do CEP sozinha, pelo serviço externo. É o caminho normal;
 *   2. o gestor cola do Google Maps. É o único que funciona em cidade pequena
 *      de Rondônia, onde o CEP é UM SÓ para o município inteiro.
 *
 * Sem coordenada o comitê continua valendo: ele aparece para quem está na mesma
 * cidade, só que sem distância. Número errado seria pior — e por isso a tela
 * avisa quando a coordenada não veio.
 */
export function ComitesDoCandidato({
  candidatoId, comites, municipios,
}: {
  candidatoId: string;
  comites: Linha[];
  municipios: Municipio[];
}) {
  const [criando, setCriando] = useState(false);
  const [editando, setEditando] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  return (
    <Cartao className="p-6">
      <div className="mb-1 flex flex-wrap items-center gap-3">
        <h2 className="mr-auto flex items-center gap-2 font-semibold">
          <Building2 size={16} className="text-suave" /> Comitês
        </h2>
        {!criando && (
          <Botao tamanho="p" variante="neutro"
                 onClick={() => { setErro(null); setAviso(null); setEditando(null); setCriando(true); }}>
            <Plus size={13} /> Novo comitê
          </Botao>
        )}
      </div>
      <p className="mb-4 text-xs leading-relaxed text-suave">
        Quando alguém informa o endereço para receber material — na página deste candidato ou na
        conversa com o atendente — o sistema mostra o comitê mais perto.{' '}
        <strong className="text-texto">A distância é em linha reta</strong>, e a tela diz isso:
        em Rondônia a estrada costuma ser bem mais longa.
      </p>

      {erro && <Aviso tom="erro" className="mb-4">{erro}</Aviso>}
      {aviso && <Aviso tom="alerta" className="mb-4">{aviso}</Aviso>}

      {comites.length === 0 && !criando ? (
        <p className="text-sm text-suave">
          Nenhum comitê cadastrado. Sem eles, ninguém é informado de onde buscar material.
        </p>
      ) : (
        <ul className="space-y-2">
          {comites.map((c) => (
            <li key={c.id}>
              {editando === c.id ? (
                <Formulario
                  candidatoId={candidatoId} municipios={municipios} comite={c}
                  aoFechar={() => setEditando(null)}
                  aoErro={setErro} aoAviso={setAviso}
                />
              ) : (
                <div className={cx('flex flex-wrap items-center gap-3 rounded-2xl border p-3.5',
                  c.ativo ? 'border-borda' : 'border-borda bg-fundo/40')}>
                  <div className="mr-auto min-w-0">
                    <p className={cx('text-sm font-semibold', !c.ativo && 'text-suave line-through')}>
                      {c.nome}
                    </p>
                    <p className="truncate text-xs text-suave">
                      {enderecoDoComite(c) || 'sem endereço'}
                      {c.cep && ` · ${formatarCep(c.cep)}`}
                    </p>
                    {c.horario && <p className="text-xs text-suave">{c.horario}</p>}
                  </div>

                  {c.latitude === null
                    ? (
                      // `Pilula` não aceita `title`; o span leva a explicação.
                      <span title="Só aparece para quem está na mesma cidade, e sem distância">
                        <Pilula cor="alerta">sem coordenada</Pilula>
                      </span>
                    )
                    : <Pilula cor="acento"><MapPin size={11} /> no mapa</Pilula>}

                  {!c.ativo && <Pilula>desativado</Pilula>}

                  <Botao tamanho="p" variante="neutro" disabled={ocupado}
                         onClick={() => { setErro(null); setCriando(false); setEditando(c.id); }}>
                    Editar
                  </Botao>
                  <Botao tamanho="p" variante="fantasma" disabled={ocupado}
                         onClick={() => iniciar(async () => {
                           const r = await alternarComite(c.id, !c.ativo);
                           if (r.ok) router.refresh(); else setErro(r.erro);
                         })}>
                    <Power size={12} /> {c.ativo ? 'Desativar' : 'Reativar'}
                  </Botao>
                  <button type="button" title="Apagar" disabled={ocupado}
                          className="text-suave transition-colors hover:text-perigo disabled:opacity-45"
                          onClick={() => iniciar(async () => {
                            const r = await removerComite(c.id);
                            if (r.ok) router.refresh(); else setErro(r.erro);
                          })}>
                    <Trash2 size={14} />
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {criando && (
        <div className="mt-3">
          <Formulario
            candidatoId={candidatoId} municipios={municipios} comite={null}
            aoFechar={() => setCriando(false)}
            aoErro={setErro} aoAviso={setAviso}
          />
        </div>
      )}
    </Cartao>
  );
}

function Formulario({
  candidatoId, municipios, comite, aoFechar, aoErro, aoAviso,
}: {
  candidatoId: string;
  municipios: Municipio[];
  comite: Linha | null;
  aoFechar: () => void;
  aoErro: (e: string | null) => void;
  aoAviso: (a: string | null) => void;
}) {
  const [nome, setNome] = useState(comite?.nome ?? '');
  const [municipioId, setMunicipioId] = useState<number | ''>(comite?.municipio_id ?? '');
  const [cep, setCep] = useState(comite?.cep ? formatarCep(comite.cep) : '');
  const [rua, setRua] = useState(comite?.rua ?? '');
  const [numero, setNumero] = useState(comite?.numero ?? '');
  const [bairro, setBairro] = useState(comite?.bairro ?? '');
  const [coordenada, setCoordenada] = useState(
    comite?.latitude != null ? `${comite.latitude}, ${comite.longitude}` : '',
  );
  const [horario, setHorario] = useState(comite?.horario ?? '');
  const [telefone, setTelefone] = useState(comite?.telefone ?? '');
  const [observacao, setObservacao] = useState(comite?.observacao ?? '');
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  return (
    <form
      className="space-y-3 rounded-2xl border border-borda p-4"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await salvarComite({
            id: comite?.id,
            candidatoId,
            nome,
            municipioId: municipioId === '' ? null : municipioId,
            cep, rua, numero, bairro, coordenada, horario, telefone, observacao,
          });
          if (!r.ok) { aoErro(r.erro); return; }
          aoErro(null);
          aoAviso(r.semCoordenada
            ? 'Comitê salvo, mas sem coordenada: o CEP não devolveu o ponto no mapa — o que é '
              + 'comum em cidade pequena, onde o CEP vale para o município inteiro. Ele vai '
              + 'aparecer para quem está na mesma cidade, mas sem a distância. Para ter a '
              + 'distância, abra o Google Maps, clique com o botão direito no local e cole aqui '
              + 'os números que ele copia.'
            : null);
          aoFechar();
          router.refresh();
        });
      }}
    >
      <Campo rotulo="Nome do comitê" value={nome} maxLength={80} autoFocus
             onChange={(e) => setNome(e.target.value)} placeholder="ex.: Comitê Central" />

      <div className="grid gap-3 sm:grid-cols-2">
        <Selecao rotulo="Cidade" value={municipioId}
                 onChange={(e) => setMunicipioId(e.target.value ? Number(e.target.value) : '')}>
          <option value="">Escolha</option>
          {municipios.map((m) => <option key={m.id} value={m.id}>{m.nome}</option>)}
        </Selecao>
        <Campo rotulo="CEP" value={cep} maxLength={9} inputMode="numeric"
               onChange={(e) => setCep(mascaraCep(e.target.value))} placeholder="76801-000" />
      </div>

      <div className="grid gap-3 sm:grid-cols-[2fr_1fr]">
        <Campo rotulo="Rua" value={rua} maxLength={120} onChange={(e) => setRua(e.target.value)} />
        <Campo rotulo="Número" value={numero} maxLength={20} onChange={(e) => setNumero(e.target.value)} />
      </div>
      <Campo rotulo="Bairro" value={bairro} maxLength={80} onChange={(e) => setBairro(e.target.value)} />

      <Campo
        rotulo="Ponto no mapa (opcional)"
        value={coordenada} maxLength={60}
        onChange={(e) => setCoordenada(e.target.value)}
        placeholder="-8.76077, -63.8999"
        dica={'Sai do CEP sozinho na maioria dos casos. Preencha aqui quando o CEP for de cidade '
          + 'pequena: abra o Google Maps, clique com o botão direito no local e cole os números.'}
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <Campo rotulo="Horário" value={horario} maxLength={80}
               onChange={(e) => setHorario(e.target.value)}
               placeholder="Segunda a sexta, 8h às 18h" />
        <Campo rotulo="Telefone" value={telefone} maxLength={24}
               onChange={(e) => setTelefone(e.target.value)} />
      </div>

      <Campo rotulo="Observação interna" value={observacao} maxLength={200}
             onChange={(e) => setObservacao(e.target.value)}
             dica="Só o gestor vê. Não aparece na página pública nem para o eleitor." />

      <div className="flex gap-2">
        <Botao type="submit" tamanho="p" disabled={nome.trim().length < 2 || ocupado}>
          <Check size={13} /> {ocupado ? 'Salvando…' : 'Salvar comitê'}
        </Botao>
        <Botao type="button" tamanho="p" variante="neutro" disabled={ocupado} onClick={aoFechar}>
          <X size={13} /> Cancelar
        </Botao>
      </div>
    </form>
  );
}
