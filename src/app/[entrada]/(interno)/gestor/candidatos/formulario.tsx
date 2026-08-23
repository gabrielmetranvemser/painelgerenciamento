'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AlertTriangle, Link2 } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, AreaTexto, Selecao, cx } from '@/components/ui';
import { DIGITOS_DO_CARGO, ROTULO_CARGO, type Candidato, type CargoEleitoral } from '@/lib/tipos-banco';
import { criarCandidato, salvarCandidato, type Resultado } from './acoes';

const CARGOS = Object.keys(ROTULO_CARGO) as CargoEleitoral[];

/** Sugere o endereço a partir do nome, mas só enquanto o gestor não mexeu nele. */
function paraSlug(nome: string) {
  return nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    .replace(/-+$/, '');
}

export function FormularioCandidato({
  candidato, origem,
}: {
  candidato?: Candidato;
  /** Domínio para montar a prévia do endereço público. */
  origem: string;
}) {
  const editando = Boolean(candidato);
  const [nome, setNome] = useState(candidato?.nome_urna ?? '');
  const [slug, setSlug] = useState(candidato?.slug ?? '');
  const [slugTocado, setSlugTocado] = useState(editando);
  const [cargo, setCargo] = useState<CargoEleitoral>(candidato?.cargo ?? 'deputado_federal');
  const [numero, setNumero] = useState(candidato?.numero ?? '');
  const [estado, setEstado] = useState<Resultado | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  const slugFinal = slugTocado ? slug : paraSlug(nome);
  const digitos = DIGITOS_DO_CARGO[cargo];
  const numeroErrado = numero.length > 0 && numero.length !== digitos;

  function enviar(form: FormData) {
    form.set('slug', slugFinal);
    iniciar(async () => {
      const r = editando ? await salvarCandidato(candidato!.id, form) : await criarCandidato(null, form);
      setEstado(r);
      if (r.ok) {
        if (!editando) { setNome(''); setSlug(''); setSlugTocado(false); setNumero(''); }
        router.refresh();
      }
    });
  }

  return (
    <form action={enviar} className="space-y-5">
      <Cartao className="p-6">
        <h2 className="mb-4 font-semibold">Identificação eleitoral</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="Nome de urna" name="nome_urna" required value={nome}
                 onChange={(e) => setNome(e.target.value)} placeholder="Como aparece na urna" />
          <Campo rotulo="Nome completo" name="nome_completo" defaultValue={candidato?.nome_completo ?? ''}
                 dica="Opcional. Usado só em documento e relatório." />
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Selecao rotulo="Cargo" name="cargo" value={cargo}
                   onChange={(e) => setCargo(e.target.value as CargoEleitoral)}>
            {CARGOS.map((c) => <option key={c} value={c}>{ROTULO_CARGO[c]}</option>)}
          </Selecao>
          <Campo rotulo={`Número (${digitos} dígitos)`} name="numero" required inputMode="numeric"
                 value={numero} onChange={(e) => setNumero(e.target.value.replace(/\D/g, ''))}
                 className={cx(numeroErrado && 'border-perigo')}
                 dica={numeroErrado ? `Faltam ou sobram dígitos: ${ROTULO_CARGO[cargo]} tem ${digitos}.` : undefined} />
          <Selecao rotulo="Vaga" name="vaga" defaultValue={String(candidato?.vaga ?? 1)}
                   disabled={cargo !== 'senador'}
                   dica={cargo === 'senador' ? 'São duas vagas ao Senado.' : 'Só senador tem 2ª vaga.'}>
            <option value="1">1ª vaga</option>
            <option value="2">2ª vaga</option>
          </Selecao>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-4">
          <Campo rotulo="UF" name="uf" maxLength={2} defaultValue={candidato?.uf ?? 'RO'} />
          <Campo rotulo="Partido" name="partido_sigla" defaultValue={candidato?.partido_sigla ?? ''} placeholder="Sigla" />
          <Campo rotulo="Nº do partido" name="partido_numero" defaultValue={candidato?.partido_numero ?? ''} />
          <Campo rotulo="Coligação" name="coligacao" defaultValue={candidato?.coligacao ?? ''} />
        </div>
      </Cartao>

      <Cartao className="p-6">
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Link2 size={16} className="text-suave" /> Endereço público
        </h2>
        <p className="mb-4 text-xs leading-relaxed text-suave">
          É o link que vai no botão do site do candidato. Quem clica cai direto na captação.
        </p>
        <Campo rotulo="Endereço" value={slugFinal}
               onChange={(e) => { setSlugTocado(true); setSlug(e.target.value.toLowerCase()); }}
               placeholder="maria-souza" />
        <p className="mt-2 truncate rounded-xl border border-borda bg-superficie-alta px-3 py-2 font-mono text-xs text-suave">
          {origem}/{slugFinal || '…'}
        </p>
      </Cartao>

      <Cartao className="p-6">
        <h2 className="mb-1 font-semibold">Identificação do material</h2>
        <Aviso tom="alerta" className="mb-4" icone={<AlertTriangle size={16} />}>
          Material de propaganda eleitoral costuma precisar de identificação —
          CNPJ da campanha e responsável. <strong>Quais campos são obrigatórios e como devem
          aparecer é pergunta para o advogado eleitoral</strong>, e precisa ser respondida antes de
          qualquer peça circular. Os campos existem aqui para você já ter onde guardar.
        </Aviso>
        <div className="grid gap-4 sm:grid-cols-2">
          <Campo rotulo="CNPJ da campanha" name="cnpj_campanha" defaultValue={candidato?.cnpj_campanha ?? ''}
                 placeholder="00.000.000/0001-00" />
          <Campo rotulo="Responsável pelo material" name="responsavel_material"
                 defaultValue={candidato?.responsavel_material ?? ''} />
        </div>
      </Cartao>

      <Cartao className="p-6">
        <h2 className="mb-4 font-semibold">Identidade e página pública</h2>
        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Cor" name="cor_tema" type="color"
                 defaultValue={candidato?.cor_tema ?? '#1d4ed8'} className="h-12 p-1" />
          <div className="sm:col-span-2">
            <Campo rotulo="Foto (URL)" name="foto_url" defaultValue={candidato?.foto_url ?? ''}
                   placeholder="https://…" />
          </div>
        </div>
        <div className="mt-4">
          <Campo rotulo="Slogan" name="slogan" defaultValue={candidato?.slogan ?? ''} maxLength={120} />
        </div>
        <div className="mt-4">
          <AreaTexto rotulo="Chamada da página" name="chamada" rows={2} maxLength={300}
                     defaultValue={candidato?.chamada ?? ''}
                     dica="A frase que a pessoa lê antes do formulário." />
        </div>
        <div className="mt-4">
          <AreaTexto rotulo="Propostas" name="propostas" rows={6} maxLength={4000}
                     defaultValue={candidato?.propostas ?? ''} />
        </div>
        <label className="mt-4 flex items-center gap-2">
          <input type="checkbox" name="ativo" defaultChecked={candidato?.ativo ?? true}
                 className="size-4 accent-[var(--acento)]" />
          <span className="text-sm">Candidatura ativa</span>
        </label>
        <p className="mt-1.5 text-xs text-suave">
          Inativa some da chapa e a página pública dela para de responder.
        </p>
      </Cartao>

      {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}
      {estado?.ok && <Aviso tom="ok">{editando ? 'Salvo.' : 'Candidato criado.'}</Aviso>}

      <Botao type="submit" tamanho="g" disabled={ocupado || numeroErrado}>
        {ocupado ? 'Salvando…' : editando ? 'Salvar alterações' : 'Cadastrar candidato'}
      </Botao>
    </form>
  );
}
