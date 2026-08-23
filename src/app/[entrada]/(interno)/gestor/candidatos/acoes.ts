'use server';

import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { TEXTO_PROBLEMA_SLUG, validarSlug } from '@/lib/slug';
import { DIGITOS_DO_CARGO, type CargoEleitoral } from '@/lib/tipos-banco';

/**
 * Sem `revalidatePath` de propósito.
 *
 * Todas as telas do gestor são `force-dynamic`, então já buscam dados a cada
 * requisição — não há cache a invalidar. Invalidar o layout inteiro seria
 * trabalho jogado fora a cada gravação.
 *
 * Quem atualiza a tela depois da ação é o `router.refresh()` do componente.
 */

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
  foto_url: z.string().trim().max(500).optional().or(z.literal('')),
  slogan: z.string().trim().max(120).optional().or(z.literal('')),
  chamada: z.string().trim().max(300).optional().or(z.literal('')),
  propostas: z.string().trim().max(4000).optional().or(z.literal('')),
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
    foto_url: form.get('foto_url') ?? '',
    slogan: form.get('slogan') ?? '',
    chamada: form.get('chamada') ?? '',
    propostas: form.get('propostas') ?? '',
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
    foto_url: limpar(d.foto_url),
    slogan: limpar(d.slogan),
    chamada: limpar(d.chamada),
    propostas: limpar(d.propostas),
    ativo: d.ativo,
  };
}

function traduzir(mensagem: string): string {
  if (mensagem.includes('candidatos_slug_key')) return 'Já existe um candidato com esse endereço.';
  if (mensagem.includes('numero_bate_com_o_cargo')) return 'O número não bate com a quantidade de dígitos do cargo.';
  if (mensagem.includes('so_senador_tem_segunda_vaga')) return 'Só senador tem 2ª vaga.';
  if (mensagem.includes('candidatos_slug_check')) return TEXTO_PROBLEMA_SLUG.formato;
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

  return { ok: true };
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
  return { ok: true };
}

export async function alternarMaterial(id: string, ativo: boolean) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  await supabase.from('materiais').update({ ativo }).eq('id', id);
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
  return { ok: true };
}
