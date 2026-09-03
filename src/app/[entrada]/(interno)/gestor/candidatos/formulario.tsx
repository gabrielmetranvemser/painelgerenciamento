'use client';

import { useRouter } from 'next/navigation';
import { useState, useTransition } from 'react';
import { AlertTriangle, BadgeCheck, Globe, Link2, Loader2 } from 'lucide-react';
import { Aviso, Botao, Campo, Cartao, AreaTexto, Selecao, cx } from '@/components/ui';
import { DIGITOS_DO_CARGO, ROTULO_CARGO, type Candidato, type CargoEleitoral } from '@/lib/tipos-banco';
import { normalizarDominio, problemaNoDominio, TEXTO_PROBLEMA_DOMINIO } from '@/lib/dominio';
import { conferirDominio, criarCandidato, salvarCandidato, type Resultado, type ResultadoDominio } from './acoes';
import { EnvioImagem } from './[id]/envio-imagem';

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
  corTema, corFundo, corSuperficie, tema, foto, fundoImagem, nome,
}: {
  corTema: string; corFundo: string | null; corSuperficie: string | null;
  tema: Tema; foto: string | null; fundoImagem: string | null; nome: string;
}) {
  const escuro = tema !== 'claro';
  const fundo = corFundo ?? (escuro ? '#08090b' : '#f4f4f3');
  const cartao = corSuperficie ?? (escuro ? '#121316' : '#ffffff');
  // O campo é o cartão com UM passo de contraste. Dois seletores para duas
  // cores que precisam combinar é pedir para alguém escolher errado.
  const campo = degrau(cartao);
  const texto = contrasta(cartao);
  const suave = mistura(texto, cartao, 0.45);
  const borda = mistura(texto, cartao, 0.14);

  return (
    <div className="mt-5">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
        Prévia {tema === 'auto' && '(no aparelho em modo escuro)'}
      </p>

      <div
        className="overflow-hidden rounded-2xl border border-borda p-6 text-center"
        style={{
          background: fundo,
          ...(fundoImagem
            ? { backgroundImage: `url(${fundoImagem})`, backgroundSize: 'cover', backgroundPosition: 'center' }
            : {}),
        }}
      >
        {foto && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={foto} alt="" className="mx-auto mb-3 h-12 w-auto object-contain"
               onError={(e) => { e.currentTarget.style.display = 'none'; }} />
        )}

        <div className="mx-auto max-w-xs rounded-2xl p-5"
             style={{ background: cartao, border: `1px solid ${borda}` }}>
          <p className="text-xs" style={{ color: suave }}>Deputado federal · nº 0000</p>
          <p className="font-display text-lg font-semibold" style={{ color: texto }}>{nome}</p>
          <div className="mt-4 space-y-2">
            <div className="h-9 rounded-xl" style={{ background: campo, border: `1px solid ${borda}` }} />
            <div className="h-9 rounded-xl" style={{ background: campo, border: `1px solid ${borda}` }} />
            <div className="grid h-10 place-items-center rounded-full text-sm font-semibold"
                 style={{ background: corTema, color: contrasta(corTema) }}>
              Quero receber o material
            </div>
          </div>
        </div>
      </div>

      {/* Os dois defeitos fáceis de cometer aqui, e que só aparecem depois de
          publicado: o botão sumindo no cartão, e o texto sumindo no cartão. */}
      <Contraste rotulo="o botão quase some no formulário" a={corTema} b={cartao} />
      <Contraste rotulo="o texto quase some no formulário" a={texto} b={campo} minimo={4.5} />
    </div>
  );
}

function Contraste({ rotulo, a, b, minimo = 3 }: {
  rotulo: string; a: string; b: string; minimo?: number;
}) {
  const r = razao(a, b);
  if (r >= minimo) return null;
  return (
    <p className="mt-2 flex items-start gap-2 rounded-2xl border border-alerta/25 bg-alerta/10 px-4 py-3 text-xs leading-relaxed text-alerta">
      <AlertTriangle size={14} className="mt-px shrink-0" />
      <span>
        Atenção: {rotulo} — o contraste é de {r.toFixed(1)}:1 e o mínimo confortável
        é {minimo}:1. Clareie ou escureça uma das duas cores.
      </span>
    </p>
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

function canais(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function paraHex([r, g, b]: number[]): string {
  return `#${[r, g, b].map((c) => Math.max(0, Math.min(255, Math.round(c))).toString(16).padStart(2, '0')).join('')}`;
}

/** Mistura duas cores. `p` é quanto de `a` entra. */
function mistura(a: string, b: string, p: number): string {
  const [ar, ag, ab] = canais(a);
  const [br, bg, bb] = canais(b);
  return paraHex([ar * p + br * (1 - p), ag * p + bg * (1 - p), ab * p + bb * (1 - p)]);
}

/**
 * Um passo de contraste a partir de uma cor: clareia se ela é escura, escurece
 * se é clara. É como o campo se separa do cartão sem um segundo seletor.
 */
function degrau(hex: string): string {
  return mistura(luminancia(hex) > 0.42 ? '#000000' : '#ffffff', hex, 0.06);
}

/** Sugere o endereço a partir do nome, mas só enquanto o gestor não mexeu nele. */
function paraSlug(nome: string) {
  return nome
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)
    .replace(/-+$/, '');
}

/**
 * Domínio próprio do candidato.
 *
 * ⚠️ O botão "Conferir" não é conforto: é a trava. Enquanto ele não passar, o
 * domínio fica cadastrado mas os links continuam saindo no endereço padrão.
 *
 * A razão é que três dos quatro passos não são deste painel — o CNAME mora no
 * DNS da campanha, o domínio precisa entrar no projeto da Vercel e o
 * certificado leva minutos para sair. Se o painel confiasse no que foi digitado,
 * as mensagens dessa janela sairiam com um link que ainda não abre, o envio
 * seria registrado do mesmo jeito e ninguém descobriria: o que some é o clique,
 * que é justamente a prova de que a pessoa abriu o material.
 */
function DominioProprio({
  candidatoId, salvo, verificadoEm, valor, aoMudar,
}: {
  candidatoId: string | null;
  /** O que está NO BANCO. Conferir só faz sentido sobre o que já foi salvo. */
  salvo: string | null;
  verificadoEm: string | null;
  valor: string;
  aoMudar: (v: string) => void;
}) {
  const [resultado, setResultado] = useState<ResultadoDominio | null>(null);
  const [conferindo, iniciar] = useTransition();
  const router = useRouter();

  const host = normalizarDominio(valor);
  const problema = host ? problemaNoDominio(host) : null;
  const naoSalvo = host !== salvo;
  const verificado = Boolean(verificadoEm) && !naoSalvo;

  function conferir() {
    if (!candidatoId) return;
    iniciar(async () => {
      const r = await conferirDominio(candidatoId);
      setResultado(r);
      if (r.ok) router.refresh();
    });
  }

  return (
    <Cartao className="p-6">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Globe size={16} className="text-suave" /> Domínio próprio
      </h2>
      <p className="mb-4 text-xs leading-relaxed text-suave">
        Opcional. Faz a página acima atender também num endereço da campanha, e é
        esse endereço que passa a aparecer nos links enviados daqui para a frente.
        O que já foi enviado continua abrindo no endereço antigo.
      </p>

      <Campo
        rotulo="Endereço"
        name="dominio"
        value={valor}
        onChange={(e) => aoMudar(e.target.value)}
        onBlur={() => aoMudar(host ?? '')}
        placeholder="material.exemplo.com.br"
        className={cx(problema && 'border-perigo')}
        dica={problema ? TEXTO_PROBLEMA_DOMINIO[problema] : undefined}
      />

      {host && !problema && (
        <>
          <p className="mt-3 flex items-center gap-2 text-xs">
            {verificado ? (
              <>
                <BadgeCheck size={14} className="shrink-0 text-ok" />
                <span className="text-ok">
                  No ar. Os links deste candidato saem em {host}.
                </span>
              </>
            ) : (
              <span className="text-alerta">
                {naoSalvo
                  ? 'Salve o candidato e depois confira este endereço.'
                  : 'Cadastrado, mas ainda não conferido — os links continuam saindo no endereço padrão.'}
              </span>
            )}
          </p>

          {!verificado && (
            <div className="mt-4 rounded-2xl border border-borda bg-superficie-alta p-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.08em] text-suave">
                Para o endereço existir
              </p>
              <ol className="list-inside list-decimal space-y-1.5 text-xs leading-relaxed text-suave">
                <li>
                  No DNS de <span className="font-mono">{dominioRaiz(host)}</span>, crie um CNAME de{' '}
                  <span className="font-mono text-texto">{host.split('.')[0]}</span> para{' '}
                  <span className="font-mono text-texto">cname.vercel-dns.com</span>.
                  No Cloudflare, deixe cinza (DNS only) — no laranja o certificado não sai.
                </li>
                <li>Acrescente <span className="font-mono text-texto">{host}</span> ao projeto na Vercel.</li>
                <li>Volte aqui e clique em Conferir.</li>
              </ol>
            </div>
          )}

          {candidatoId && (
            <div className="mt-4 flex items-center gap-3">
              <Botao
                type="button"
                variante="neutro"
                tamanho="p"
                onClick={conferir}
                disabled={conferindo || naoSalvo}
              >
                {conferindo && <Loader2 size={14} className="animate-spin" />}
                {verificado ? 'Conferir de novo' : 'Conferir'}
              </Botao>
              {verificadoEm && !naoSalvo && (
                <span className="text-xs text-tenue">
                  Conferido em {new Date(verificadoEm).toLocaleString('pt-BR')}
                </span>
              )}
            </div>
          )}

          {resultado && (
            <Aviso tom={resultado.ok ? 'ok' : 'alerta'} className="mt-4">
              {resultado.ok ? `${host} está no ar e responde por esta página.` : resultado.erro}
            </Aviso>
          )}
        </>
      )}
    </Cartao>
  );
}

/** "material.sofiaandrade.com.br" → "sofiaandrade.com.br", para a instrução de DNS. */
function dominioRaiz(host: string): string {
  const p = host.split('.');
  const composto = /\.(com|net|org|gov|edu|adv|art|eco|ind|inf|rec|srv|tur|vet)\.[a-z]{2}$/.test(host);
  return p.slice(-(composto ? 3 : 2)).join('.');
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
  const [foto, setFoto] = useState<string | null>(candidato?.foto_url ?? null);
  const [fundoImagem, setFundoImagem] = useState<string | null>(candidato?.fundo_url ?? null);
  const [superficiePropria, setSuperficiePropria] = useState(Boolean(candidato?.cor_superficie));
  const [corSuperficie, setCorSuperficie] = useState(candidato?.cor_superficie ?? '#151a20');
  const [dominio, setDominio] = useState(candidato?.dominio ?? '');
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
        if (!editando) { setNome(''); setSlug(''); setSlugTocado(false); setNumero(''); setDominio(''); }
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

      <DominioProprio
        candidatoId={candidato?.id ?? null}
        salvo={candidato?.dominio ?? null}
        verificadoEm={candidato?.dominio_verificado_em ?? null}
        valor={dominio}
        aoMudar={setDominio}
      />

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
          <Campo rotulo="Cor do botão" name="cor_tema" type="color" className="h-12 p-1"
                 value={corTema} onChange={(e) => setCorTema(e.target.value)} />

          <Selecao rotulo="Tema da página" name="tema" value={tema}
                   onChange={(e) => setTema(e.target.value as Tema)}>
            <option value="auto">Segue o aparelho</option>
            <option value="claro">Sempre claro</option>
            <option value="escuro">Sempre escuro</option>
          </Selecao>

          <div>
            <label className="mb-2 flex items-center gap-2">
              <input type="checkbox" name="usar_cor_fundo" checked={fundoProprio}
                     onChange={(e) => setFundoProprio(e.target.checked)}
                     className="size-4 accent-[var(--acento)]" />
              <span className="text-[13px] font-semibold">Cor de fundo</span>
            </label>
            <input type="color" name="cor_fundo" value={corFundo} disabled={!fundoProprio}
                   onChange={(e) => setCorFundo(e.target.value)}
                   className="h-12 w-full rounded-2xl border border-borda bg-superficie-alta p-1 disabled:opacity-40" />
          </div>
        </div>

        <div className="mt-4">
          <label className="mb-2 flex items-center gap-2">
            <input type="checkbox" name="usar_cor_superficie" checked={superficiePropria}
                   onChange={(e) => setSuperficiePropria(e.target.checked)}
                   className="size-4 accent-[var(--acento)]" />
            <span className="text-[13px] font-semibold">Cor do formulário</span>
          </label>
          <div className="flex items-center gap-3">
            <input type="color" name="cor_superficie" value={corSuperficie} disabled={!superficiePropria}
                   onChange={(e) => setCorSuperficie(e.target.value)}
                   className="h-12 w-24 shrink-0 rounded-2xl border border-borda bg-superficie-alta p-1 disabled:opacity-40" />
            <p className="text-xs leading-relaxed text-suave">
              Pinta o cartão e os campos. Os campos saem um tom acima ou abaixo desta cor,
              sozinhos — dois seletores para duas cores que precisam combinar é pedir para
              alguém escolher errado.
            </p>
          </div>
        </div>

        {editando ? (
          <div className="mt-5 grid gap-5 border-t border-borda pt-5 sm:grid-cols-2">
            <EnvioImagem
              candidatoId={candidato!.id} tipo="logo" rotulo="Logo" ladoMaximo={800}
              urlAtual={foto} aoMudar={setFoto}
              dica="Aparece no alto da página. PNG ou SVG com fundo transparente fica melhor. Vira WebP no envio."
            />
            <EnvioImagem
              candidatoId={candidato!.id} tipo="fundo" rotulo="Imagem de fundo" ladoMaximo={1920}
              urlAtual={fundoImagem} aoMudar={setFundoImagem}
              dica="Cobre a tela inteira. A cor de fundo fica por baixo e é o que a pessoa vê enquanto a imagem carrega. Vira WebP no envio."
            />
          </div>
        ) : (
          <p className="mt-5 border-t border-borda pt-5 text-xs leading-relaxed text-suave">
            Logo e imagem de fundo entram depois de salvar — o arquivo precisa de um candidato
            para pertencer.
          </p>
        )}

        <PreviaLink corTema={corTema} corFundo={fundoProprio ? corFundo : null} tema={tema}
                    corSuperficie={superficiePropria ? corSuperficie : null}
                    foto={foto} fundoImagem={fundoImagem} nome={nome || 'Nome de urna'} />

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
