'use server';

import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar } from '@/lib/gestor';
import { coordenadaDoCep } from '@/lib/busca-cep';
import { normalizarCep } from '@/lib/cep';
import { comiteMaisPerto, type Comite, type ComitePerto } from '@/lib/comites';
import { coordenadaPlausivel, lerCoordenada } from '@/lib/distancia';

/** Os comitês ativos de um candidato. Usado pela página pública. */
export async function comitesDoCandidato(candidatoId: string): Promise<Comite[]> {
  const supabase = criarClienteAdmin();
  const { data, error } = await supabase.rpc('comites_do_candidato', {
    p_candidato_id: candidatoId,
  });
  if (error) return [];
  return (data ?? []) as Comite[];
}

/** Os comitês dos candidatos declarados a este contato. Visão do atendente. */
export async function comitesDoContato(contatoId: string): Promise<Comite[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('comites_do_contato', {
    p_contato_id: contatoId,
  });
  if (error) return [];
  return (data ?? []) as Comite[];
}

/**
 * Qual comitê está mais perto de um CEP.
 *
 * ⚠️ A consulta ao serviço de coordenadas roda AQUI, no servidor, e não no
 * navegador de quem digitou o CEP. É a mesma razão do cabeçalho de
 * `busca-cep.ts`: o eleitor não fala com terceiro — quem pergunta é a nossa
 * Vercel, e o serviço externo só vê ela.
 *
 * Falhar é normal: em cidade pequena de Rondônia o CEP é um só para o município
 * inteiro e o serviço não devolve coordenada. Aí a resposta cai para o critério
 * de município, sem número.
 */
export async function comitePerto(
  comites: Comite[],
  cep: string | null,
  municipioId: number | null,
): Promise<ComitePerto> {
  const limpo = normalizarCep(cep);
  const ponto = limpo ? await coordenadaDoCep(limpo) : null;
  return comiteMaisPerto(comites, { ponto, municipioId });
}

// ── Cadastro (gestor) ────────────────────────────────────────────────────────

export async function carregarComites(candidatoId: string) {
  await exigirGestorOuFalhar();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from('comites').select('*').eq('candidato_id', candidatoId).order('nome');
  if (error) throw new Error(error.message);
  return (data ?? []) as (Comite & { candidato_id: string; ativo: boolean; observacao: string | null })[];
}

export type ResultadoComite = { ok: true; semCoordenada: boolean } | { ok: false; erro: string };

/**
 * Cria ou atualiza um comitê.
 *
 * A coordenada tem dois caminhos, nesta ordem:
 *
 *   1. o gestor cola do Google Maps ("-8.76077, -63.8999"). É o confiável, e
 *      ganha de tudo — ele está vendo o ponto no mapa.
 *   2. sai do CEP, pelo serviço externo. Falha em cidade pequena, onde o CEP é
 *      do município inteiro.
 *
 * Sem nenhum dos dois a linha é gravada assim mesmo, e a resposta avisa: o
 * comitê ainda aparece para quem está na mesma cidade, só não aparece com
 * distância. Recusar o cadastro por falta de coordenada seria impedir o gestor
 * de registrar um comitê que existe.
 */
export async function salvarComite(dados: {
  id?: string;
  candidatoId: string;
  nome: string;
  municipioId: number | null;
  cep: string | null;
  rua: string | null;
  numero: string | null;
  bairro: string | null;
  /** Colado do Google Maps. Vence o CEP quando existe. */
  coordenada: string | null;
  horario: string | null;
  telefone: string | null;
  observacao: string | null;
}): Promise<ResultadoComite> {
  await exigirGestorOuFalhar();

  const nome = dados.nome.trim();
  if (nome.length < 2 || nome.length > 80) {
    return { ok: false, erro: 'O nome do comitê precisa ter de 2 a 80 caracteres.' };
  }

  const cep = normalizarCep(dados.cep);

  let lat: number | null = null;
  let lon: number | null = null;

  if (dados.coordenada?.trim()) {
    const p = lerCoordenada(dados.coordenada);
    if (!p) {
      return {
        ok: false,
        erro: 'Não entendi a coordenada. Cole no formato do Google Maps, ex.: -8.76077, -63.8999.',
      };
    }
    lat = p.lat; lon = p.lon;
  } else if (cep) {
    const p = await coordenadaDoCep(cep);
    if (p && coordenadaPlausivel(p)) { lat = p.lat; lon = p.lon; }
  }

  const linha = {
    candidato_id: dados.candidatoId,
    nome,
    municipio_id: dados.municipioId,
    cep,
    rua: dados.rua?.trim() || null,
    numero: dados.numero?.trim() || null,
    bairro: dados.bairro?.trim() || null,
    latitude: lat,
    longitude: lon,
    horario: dados.horario?.trim() || null,
    telefone: dados.telefone?.trim() || null,
    observacao: dados.observacao?.trim() || null,
  };

  const supabase = criarClienteAdmin();
  const { error } = dados.id
    ? await supabase.from('comites').update(linha).eq('id', dados.id)
    : await supabase.from('comites').insert(linha);

  if (error) return { ok: false, erro: error.message };
  return { ok: true, semCoordenada: lat === null };
}

export async function alternarComite(id: string, ativo: boolean) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('comites').update({ ativo }).eq('id', id);
  return error ? { ok: false as const, erro: error.message } : { ok: true as const };
}

export async function removerComite(id: string) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('comites').delete().eq('id', id);
  return error ? { ok: false as const, erro: error.message } : { ok: true as const };
}
