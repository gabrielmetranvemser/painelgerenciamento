'use server';

import { updateTag } from 'next/cache';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { ETIQUETA_CANDIDATOS } from '@/lib/cache';
import { TEXTO_PROBLEMA_SLUG, validarSlug } from '@/lib/slug';
import { normalizarDominio, problemaNoDominio, TEXTO_PROBLEMA_DOMINIO } from '@/lib/dominio';
import { DIGITOS_DO_CARGO, type CargoEleitoral } from '@/lib/tipos-banco';

/**
 * Sem `revalidatePath` de propósito.
 *
 * Todas as telas do gestor são `force-dynamic`, então já buscam dados a cada
 * requisição — não há cache de PÁGINA a invalidar. Quem atualiza a tela depois
 * da ação é o `router.refresh()` do componente.
 *
 * O que existe é cache de DADOS, e só num lugar: a página pública do candidato
 * guarda a consulta por um minuto para não ir ao banco a cada visita da
 * internet inteira. Toda ação daqui derruba essa etiqueta — senão o gestor
 * edita a página, abre para conferir, e vê o texto antigo.
 */
function publicarMudanca() {
  // `updateTag`, e não `revalidateTag`: aqui o caso é ler-a-própria-escrita —
  // o gestor salva, abre a página do candidato para conferir, e precisa ver o
  // que acabou de escrever. `revalidateTag` serviria o conteúdo velho uma vez.
  //
  // Se um dia esta chamada deixar de alcançar o cache, o prejuízo é limitado:
  // a consulta expira sozinha em 60 segundos de qualquer jeito.
  updateTag(ETIQUETA_CANDIDATOS);
}

export type Resultado = { ok: true; id?: string } | { ok: false; erro: string };

const CARGOS = [
  'presidente', 'governador', 'senador',
  'deputado_federal', 'deputado_estadual', 'deputado_distrital',
] as const;

const Candidato = z.object({
  slug: z.string().trim().toLowerCase(),
  nome_urna: z.string().trim().min(2, 'Escreva o nome de urna.').max(60),
  nome_completo: z.string().trim().max(120).optional().or(z.literal('')),
  cargo: z.enum(CARGOS),
  vaga: z.coerce.number().int().min(1).max(2),
  numero: z.string().trim().regex(/^[0-9]+$/, 'O número tem só dígitos.'),
  uf: z.string().trim().length(2).optional().or(z.literal('')),
  partido_sigla: z.string().trim().max(20).optional().or(z.literal('')),
  partido_numero: z.string().trim().max(3).optional().or(z.literal('')),
  coligacao: z.string().trim().max(200).optional().or(z.literal('')),
  cnpj_campanha: z.string().trim().max(20).optional().or(z.literal('')),
  responsavel_material: z.string().trim().max(200).optional().or(z.literal('')),
  cor_tema: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal('')),
  cor_fundo: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal('')),
  cor_superficie: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/).optional().or(z.literal('')),
  tema: z.enum(['auto', 'claro', 'escuro']),
  slogan: z.string().trim().max(120).optional().or(z.literal('')),
  chamada: z.string().trim().max(300).optional().or(z.literal('')),
  propostas: z.string().trim().max(4000).optional().or(z.literal('')),
  dominio: z.string().trim().max(300).optional().or(z.literal('')),
  ativo: z.boolean(),
});

function limpar(v: string | undefined) {
  return v && v.trim() ? v.trim() : null;
}

function ler(form: FormData) {
  return {
    slug: form.get('slug'),
    nome_urna: form.get('nome_urna'),
    nome_completo: form.get('nome_completo') ?? '',
    cargo: form.get('cargo'),
    vaga: form.get('vaga') ?? 1,
    numero: form.get('numero'),
    uf: form.get('uf') ?? '',
    partido_sigla: form.get('partido_sigla') ?? '',
    partido_numero: form.get('partido_numero') ?? '',
    coligacao: form.get('coligacao') ?? '',
    cnpj_campanha: form.get('cnpj_campanha') ?? '',
    responsavel_material: form.get('responsavel_material') ?? '',
    cor_tema: form.get('cor_tema') ?? '',
    cor_fundo: form.get('usar_cor_fundo') === 'on' ? (form.get('cor_fundo') ?? '') : '',
    cor_superficie: form.get('usar_cor_superficie') === 'on' ? (form.get('cor_superficie') ?? '') : '',
    tema: form.get('tema') ?? 'auto',
    slogan: form.get('slogan') ?? '',
    chamada: form.get('chamada') ?? '',
    propostas: form.get('propostas') ?? '',
    dominio: form.get('dominio') ?? '',
    ativo: form.get('ativo') === 'on',
  };
}

/**
 * Valida o que o banco também valida, mas com mensagem em português.
 *
 * A dupla checagem é de propósito: a do banco é a que não se contorna, e esta
 * existe para o gestor entender o que fazer em vez de receber um erro de
 * constraint.
 */
function conferir(d: z.infer<typeof Candidato>): string | null {
  const problemaSlug = validarSlug(d.slug);
  if (problemaSlug) return TEXTO_PROBLEMA_SLUG[problemaSlug];

  const esperado = DIGITOS_DO_CARGO[d.cargo as CargoEleitoral];
  if (d.numero.length !== esperado) {
    return `Número de ${d.cargo.replace('_', ' ')} tem ${esperado} dígitos, e você escreveu ${d.numero.length}.`;
  }
  if (d.cargo !== 'senador' && d.vaga !== 1) {
    return 'Só senador tem 2ª vaga.';
  }

  const host = normalizarDominio(d.dominio);
  if (host) {
    const problema = problemaNoDominio(host);
    if (problema) return TEXTO_PROBLEMA_DOMINIO[problema];
  }
  return null;
}

function paraBanco(d: z.infer<typeof Candidato>) {
  return {
    slug: d.slug,
    nome_urna: d.nome_urna,
    nome_completo: limpar(d.nome_completo),
    cargo: d.cargo,
    vaga: d.vaga,
    numero: d.numero,
    uf: limpar(d.uf)?.toUpperCase() ?? null,
    partido_sigla: limpar(d.partido_sigla)?.toUpperCase() ?? null,
    partido_numero: limpar(d.partido_numero),
    coligacao: limpar(d.coligacao),
    cnpj_campanha: limpar(d.cnpj_campanha),
    responsavel_material: limpar(d.responsavel_material),
    cor_tema: limpar(d.cor_tema),
    cor_fundo: limpar(d.cor_fundo),
    cor_superficie: limpar(d.cor_superficie),
    tema: d.tema,
    slogan: limpar(d.slogan),
    chamada: limpar(d.chamada),
    propostas: limpar(d.propostas),
    // Guardado já normalizado: é comparado byte a byte com o cabeçalho `Host`.
    // Quem zera o carimbo de verificação quando isto muda é o gatilho do banco,
    // não esta função — assim ninguém consegue esquecer de zerar.
    dominio: normalizarDominio(d.dominio),
    ativo: d.ativo,
  };
}

function traduzir(mensagem: string): string {
  if (mensagem.includes('candidatos_slug_key')) return 'Já existe um candidato com esse endereço.';
  if (mensagem.includes('numero_bate_com_o_cargo')) return 'O número não bate com a quantidade de dígitos do cargo.';
  if (mensagem.includes('so_senador_tem_segunda_vaga')) return 'Só senador tem 2ª vaga.';
  if (mensagem.includes('candidatos_slug_check')) return TEXTO_PROBLEMA_SLUG.formato;
  if (mensagem.includes('candidatos_dominio_uk')) return 'Esse domínio já está em outro candidato.';
  if (mensagem.includes('dominio_e_um_host')) return TEXTO_PROBLEMA_DOMINIO.formato;
  return mensagem;
}

export async function criarCandidato(_anterior: Resultado | null, form: FormData): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const analise = Candidato.safeParse(ler(form));
  if (!analise.success) return { ok: false, erro: analise.error.issues[0].message };

  const erro = conferir(analise.data);
  if (erro) return { ok: false, erro };

  const supabase = criarClienteAdmin();
  const { data, error } = await supabase
    .from('candidatos').insert(paraBanco(analise.data)).select('id').single();

  if (error) return { ok: false, erro: traduzir(error.message) };

  publicarMudanca();
  return { ok: true, id: data.id };
}

export async function salvarCandidato(id: string, form: FormData): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const analise = Candidato.safeParse(ler(form));
  if (!analise.success) return { ok: false, erro: analise.error.issues[0].message };

  const erro = conferir(analise.data);
  if (erro) return { ok: false, erro };

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('candidatos').update(paraBanco(analise.data)).eq('id', id);
  if (error) return { ok: false, erro: traduzir(error.message) };

  publicarMudanca();
  return { ok: true };
}

// ── Domínio próprio ─────────────────────────────────────────────────────────

export type ResultadoDominio =
  | { ok: true; verificadoEm: string }
  | { ok: false; erro: string };

/** Quanto esperar o domínio de terceiro responder antes de desistir. */
const ESPERA_MS = 8000;

/**
 * Confere, de fora, que o domínio cadastrado responde por ESTE candidato.
 *
 * ⚠️ Esta função é a razão de o domínio não valer assim que é digitado.
 *
 * Entre o gestor digitar `material.sofiaandrade.com.br` e aquele endereço
 * existir de verdade há três passos que NÃO são deste painel: o CNAME no DNS da
 * campanha, o domínio adicionado ao projeto na Vercel e o certificado emitido.
 * Qualquer um deles pendente e o link não abre. Como o painel registra o envio
 * do mesmo jeito e o clique é a única métrica que ele controla, o prejuízo
 * seria invisível — mensagens saindo o dia inteiro com um link morto.
 *
 * Então o painel não acredita: ele abre o endereço e pergunta de quem é. Uma
 * resposta certa prova os três passos de uma vez.
 *
 * O carimbo é apagado sozinho pelo gatilho do banco quando o domínio muda, para
 * que o "verificado" nunca seja herdado por um endereço que ninguém testou.
 */
export async function conferirDominio(id: string): Promise<ResultadoDominio> {
  await exigirGestorOuFalhar();

  const supabase = criarClienteAdmin();
  const { data: candidato } = await supabase
    .from('candidatos').select('slug, dominio').eq('id', id).maybeSingle();

  if (!candidato) return { ok: false, erro: 'Candidato não encontrado.' };
  if (!candidato.dominio) {
    return { ok: false, erro: 'Escreva o domínio e salve o candidato antes de conferir.' };
  }

  const endereco = `https://${candidato.dominio}/api/dominio`;

  let resposta: Response;
  try {
    resposta = await fetch(endereco, {
      cache: 'no-store',
      redirect: 'manual',
      signal: AbortSignal.timeout(ESPERA_MS),
    });
  } catch (e) {
    return { ok: false, erro: porQueNaoRespondeu(e, candidato.dominio) };
  }

  if (resposta.status === 404) {
    return {
      ok: false,
      erro: `${candidato.dominio} respondeu, mas ainda não é este painel. `
        + 'Falta acrescentar o domínio ao projeto na Vercel — ou o DNS ainda está '
        + 'apontando para onde apontava antes.',
    };
  }

  if (!resposta.ok) {
    return { ok: false, erro: `${candidato.dominio} respondeu com erro ${resposta.status}.` };
  }

  let dono: { slug?: string };
  try {
    dono = (await resposta.json()) as { slug?: string };
  } catch {
    return {
      ok: false,
      erro: `${candidato.dominio} respondeu outra coisa. Confira se o DNS aponta para cá.`,
    };
  }

  if (dono.slug !== candidato.slug) {
    return {
      ok: false,
      erro: `${candidato.dominio} está apontando para a página de "${dono.slug}", não para esta.`,
    };
  }

  const verificadoEm = new Date().toISOString();
  const { error } = await supabase
    .from('candidatos').update({ dominio_verificado_em: verificadoEm }).eq('id', id);
  if (error) return { ok: false, erro: error.message };

  publicarMudanca();
  return { ok: true, verificadoEm };
}

/**
 * Traduz a falha de rede para o passo que está faltando.
 *
 * Um "fetch failed" seco manda o gestor abrir um chamado. As três causas abaixo
 * são as que acontecem de verdade, e cada uma tem uma ação diferente — dizer
 * qual delas é poupa a tarde de alguém.
 */
function porQueNaoRespondeu(e: unknown, dominio: string): string {
  const causa = String(
    (e as { cause?: { code?: string } })?.cause?.code ?? (e as Error)?.name ?? e,
  );

  if (causa.includes('ENOTFOUND') || causa.includes('EAI_AGAIN')) {
    return `${dominio} ainda não existe no DNS. Crie o CNAME apontando para `
      + 'cname.vercel-dns.com e tente de novo em alguns minutos.';
  }
  if (causa.includes('CERT') || causa.includes('ALTNAME') || causa.includes('SSL')) {
    return `${dominio} responde, mas o certificado ainda não vale para ele. `
      + 'Acrescente o domínio ao projeto na Vercel e espere a emissão — costuma levar minutos.';
  }
  if (causa.includes('TimeoutError') || causa.includes('AbortError')) {
    return `${dominio} não respondeu em ${ESPERA_MS / 1000} segundos. `
      + 'Se estiver atrás do Cloudflare, deixe o registro cinza (DNS only), não laranja.';
  }
  return `Não consegui abrir ${dominio}: ${causa}`;
}

// ── Materiais ───────────────────────────────────────────────────────────────

const Material = z.object({
  titulo: z.string().trim().min(2, 'Dê um nome à peça.').max(80),
  url: z.string().trim().url('A URL precisa começar com https://'),
  tipo: z.enum(['santinho', 'propostas', 'video', 'canal', 'site', 'outro']),
  descricao: z.string().trim().max(200).optional().or(z.literal('')),
});

export async function adicionarMaterial(candidatoId: string, form: FormData): Promise<Resultado> {
  await exigirGestorOuFalhar();

  const analise = Material.safeParse({
    titulo: form.get('titulo'),
    url: form.get('url'),
    tipo: form.get('tipo') ?? 'outro',
    descricao: form.get('descricao') ?? '',
  });
  if (!analise.success) return { ok: false, erro: analise.error.issues[0].message };

  const supabase = criarClienteAdmin();
  const { data: ultimo } = await supabase
    .from('materiais').select('ordem').eq('candidato_id', candidatoId)
    .order('ordem', { ascending: false }).limit(1).maybeSingle();

  const { error } = await supabase.from('materiais').insert({
    candidato_id: candidatoId,
    titulo: analise.data.titulo,
    url: analise.data.url,
    tipo: analise.data.tipo,
    descricao: limpar(analise.data.descricao),
    ordem: (ultimo?.ordem ?? 0) + 1,
  });

  if (error) return { ok: false, erro: error.message };
  publicarMudanca();
  return { ok: true };
}

export async function alternarMaterial(id: string, ativo: boolean) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  await supabase.from('materiais').update({ ativo }).eq('id', id);
  publicarMudanca();
}

export async function removerMaterial(id: string): Promise<Resultado> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  // Apagar o material apaga os links dele em cascata, e com eles a contagem de
  // cliques daquela peça. Desativar preserva o histórico.
  const { count } = await supabase
    .from('links').select('token', { count: 'exact', head: true }).eq('material_id', id);

  if ((count ?? 0) > 0) {
    return {
      ok: false,
      erro: `Esta peça já foi enviada a ${count} pessoa(s). Apagar levaria junto a contagem de cliques dela — desative em vez de apagar.`,
    };
  }

  const { error } = await supabase.from('materiais').delete().eq('id', id);
  if (error) return { ok: false, erro: error.message };
  publicarMudanca();
  return { ok: true };
}

// ── Imagens ─────────────────────────────────────────────────────────────────

export type TipoImagem = 'logo' | 'fundo';

const COLUNA: Record<TipoImagem, 'foto_url' | 'fundo_url'> = {
  logo: 'foto_url',
  fundo: 'fundo_url',
};

/**
 * Guarda a imagem já convertida em WebP pelo navegador.
 *
 * O servidor não converte: ele CONFERE. O que chega tem de ser WebP e caber no
 * teto — o cliente pode ser burlado pelo DevTools, e um balde público que
 * aceita qualquer coisa vira hospedagem de arquivo alheio.
 *
 * O caminho é fixo por candidato e tipo, com upsert: trocar a logo substitui o
 * arquivo em vez de deixar rastro de todas as versões anteriores no balde. Por
 * isso a URL leva `?v=`, senão o navegador e a CDN continuariam servindo a
 * imagem antiga.
 */
export async function enviarImagem(
  candidatoId: string,
  tipo: TipoImagem,
  form: FormData,
): Promise<{ ok: true; url: string } | { ok: false; erro: string }> {
  await exigirGestorOuFalhar();

  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) return { ok: false, erro: 'Nenhum arquivo recebido.' };
  if (arquivo.type !== 'image/webp') {
    return { ok: false, erro: 'O arquivo precisa ser WebP. A conversão acontece no navegador.' };
  }
  if (arquivo.size > 2 * 1024 * 1024) {
    return { ok: false, erro: 'A imagem passou de 2 MB depois de convertida.' };
  }
  if (arquivo.size === 0) return { ok: false, erro: 'O arquivo chegou vazio.' };

  const supabase = criarClienteAdmin();
  const caminho = `${candidatoId}/${tipo}.webp`;

  const { error: erroUp } = await supabase.storage
    .from('candidatos')
    .upload(caminho, arquivo, { contentType: 'image/webp', upsert: true });
  if (erroUp) return { ok: false, erro: `Não consegui guardar a imagem: ${erroUp.message}` };

  const { data: publica } = supabase.storage.from('candidatos').getPublicUrl(caminho);
  const url = `${publica.publicUrl}?v=${Date.now()}`;

  const { error } = await supabase
    .from('candidatos')
    .update({ [COLUNA[tipo]]: url })
    .eq('id', candidatoId);
  if (error) return { ok: false, erro: error.message };

  publicarMudanca();
  return { ok: true, url };
}

/** Tira a imagem da página E do balde: arquivo órfão em balde público é lixo. */
export async function removerImagem(
  candidatoId: string,
  tipo: TipoImagem,
): Promise<{ ok: true } | { ok: false; erro: string }> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  await supabase.storage.from('candidatos').remove([`${candidatoId}/${tipo}.webp`]);

  const { error } = await supabase
    .from('candidatos')
    .update({ [COLUNA[tipo]]: null })
    .eq('id', candidatoId);
  if (error) return { ok: false, erro: error.message };
  publicarMudanca();
  return { ok: true };
}
