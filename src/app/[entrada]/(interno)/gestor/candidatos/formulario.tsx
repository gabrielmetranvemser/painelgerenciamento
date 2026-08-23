'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AlertTriangle, Link2 } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, AreaTexto, Selecao, cx } from '@/components/ui';
import { DIGITOS_DO_CARGO, ROTULO_CARGO, type Candidato, type CargoEleitoral } from '@/lib/tipos-banco';
import { criarCandidato, salvarCandidato, type Resultado } from './acoes';

const CARGOS = Object.keys(ROTULO_CARGO) as CargoEleitoral[];

type Tema = 'auto' | 'claro' | 'escuro';

/**
 * Prévia da página do candidato, montada com as mesmas variáveis que a página
 * pública usa.
 *
 * Escolher cor às cegas e só descobrir o resultado abrindo o link é o caminho
 * mais curto para o gestor publicar um botão ilegível. Os `style` inline são de
 * propósito: cor escolhida em runtime não pode virar classe do Tailwind, que só
 * enxerga nome literal na varredura.
 */
function PreviaLink({
  corTema, corFundo, tema, foto, nome,
}: {
  corTema: string; corFundo: string | null; tema: Tema; foto: string; nome: string;
}) {
  const escuro = tema === 'escuro' || (tema === 'auto' && true);
  const fundo = corFundo ?? (escuro ? '#0b0d0c' : '#f7f7f5');
  const texto = escuro ? '#f2f4f1' : '#16181a';
  const suave = escuro ? '#9aa3a0' : '#5b6360';

  return (
    <div className="mt-5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
        Prévia {tema === 'auto' && '(no aparelho em modo escuro)'}
      </p>
      <div className="rounded-2xl border border-borda p-6 text-center" style={{ background: fundo }}>
        {foto
          // eslint-disable-next-line @next/next/no-img-element
          ? <img src={foto} alt="" className="mx-auto mb-3 h-12 w-auto object-contain"
                 onError={(e) => { e.currentTarget.style.display = 'none'; }} />
          : null}
        <p className="text-xs" style={{ color: suave }}>Deputado federal · nº 0000</p>
        <p className="font-display text-xl font-semibold" style={{ color: texto }}>{nome}</p>
        <div className="mx-auto mt-4 max-w-xs space-y-2">
          <div className="h-9 rounded-xl" style={{ background: escuro ? '#1a1d1c' : '#ffffff', border: `1px solid ${escuro ? '#2a2f2d' : '#e2e3e0'}` }} />
          <div className="h-9 rounded-xl" style={{ background: escuro ? '#1a1d1c' : '#ffffff', border: `1px solid ${escuro ? '#2a2f2d' : '#e2e3e0'}` }} />
          <div className="grid h-10 place-items-center rounded-full text-sm font-semibold"
               style={{ background: corTema, color: contrasta(corTema) }}>
            Quero receber o material
          </div>
        </div>
      </div>

      {/* O botão sumindo no fundo é o defeito mais fácil de cometer aqui: cor
          escura da campanha num tema escuro, e o único botão da página vira um
          retângulo invisível. */}
      {razao(corTema, fundo) < 3 && (
        <p className="mt-2 flex items-start gap-2 rounded-2xl border border-alerta/25 bg-alerta/10 px-4 py-3 text-xs leading-relaxed text-alerta">
          <AlertTriangle size={14} className="mt-px shrink-0" />
          <span>
            O botão quase some no fundo desta página — o contraste é de{' '}
            {razao(corTema, fundo).toFixed(1)}:1 e o mínimo confortável é 3:1.
            Clareie a cor, ou mude o tema da página para claro.
          </span>
        </p>
      )}
    </div>
  );
}

/**
 * Preto ou branco por cima de uma cor, pelo brilho percebido.
 *
 * A fórmula é a de luminância relativa: o olho enxerga o verde muito mais que o
 * azul, então uma média simples dos três canais escolheria branco sobre amarelo
 * e o botão sumiria.
 */
function contrasta(hex: string): string {
  return luminancia(hex) > 0.42 ? '#111111' : '#ffffff';
}

/** Luminância relativa (0 a 1), pela fórmula da WCAG. */
function luminancia(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const canais = [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => {
    const v = c / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * canais[0] + 0.7152 * canais[1] + 0.0722 * canais[2];
}

/** Razão de contraste entre duas cores, de 1 (igual) a 21 (preto e branco). */
function razao(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

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
  const [corTema, setCorTema] = useState(candidato?.cor_tema ?? '#1d4ed8');
  const [fundoProprio, setFundoProprio] = useState(Boolean(candidato?.cor_fundo));
  const [corFundo, setCorFundo] = useState(candidato?.cor_fundo ?? '#0b0d0c');
  const [tema, setTema] = useState<Tema>(candidato?.tema ?? 'auto');
  const [foto, setFoto] = useState(candidato?.foto_url ?? '');
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
        <h2 className="mb-1 font-semibold">Identidade e página pública</h2>
        <p className="mb-4 text-xs leading-relaxed text-suave">
          É a cara da página que abre quando alguém clica no botão do site desta candidatura.
          Cair numa página com a cara de outra campanha derruba a confiança bem no clique que
          importa.
        </p>

        <div className="grid gap-4 sm:grid-cols-3">
          <Campo rotulo="Cor do botão" name="cor_tema" type="color"
                 defaultValue={candidato?.cor_tema ?? '#1d4ed8'} className="h-12 p-1"
                 onChange={(e) => setCorTema(e.target.value)} value={corTema} />
          <div className="sm:col-span-2">
            <Campo rotulo="Logo ou foto (URL)" name="foto_url" value={foto}
                   onChange={(e) => setFoto(e.target.value)} placeholder="https://…"
                   dica="Aparece no alto da página. Fundo transparente (PNG ou SVG) fica melhor." />
          </div>
        </div>

        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Selecao rotulo="Tema da página" name="tema" value={tema}
                   onChange={(e) => setTema(e.target.value as Tema)}>
            <option value="auto">Segue o aparelho</option>
            <option value="claro">Sempre claro</option>
            <option value="escuro">Sempre escuro</option>
          </Selecao>

          <div className="sm:col-span-2">
            <label className="mb-2 flex items-center gap-2">
              <input type="checkbox" name="usar_cor_fundo" checked={fundoProprio}
                     onChange={(e) => setFundoProprio(e.target.checked)}
                     className="size-4 accent-[var(--acento)]" />
              <span className="text-[13px] font-semibold">Fundo próprio</span>
            </label>
            <input type="color" name="cor_fundo" value={corFundo} disabled={!fundoProprio}
                   onChange={(e) => setCorFundo(e.target.value)}
                   className="h-12 w-full rounded-2xl border border-borda bg-superficie-alta p-1 disabled:opacity-40" />
            <p className="mt-2 text-xs leading-relaxed text-suave">
              Sem isto a página usa o fundo padrão, que já acompanha o tema escolhido.
            </p>
          </div>
        </div>

        <PreviaLink corTema={corTema} corFundo={fundoProprio ? corFundo : null} tema={tema}
                    foto={foto} nome={nome || 'Nome de urna'} />

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
