'use server';

import { criarClienteServidor } from '@/lib/supabase/server';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import type {
  ChamadoNaLista, MotivoChamado, StatusChamado,
} from '@/lib/tipos-banco';

export type Resposta<T = unknown> = { ok: true; dados: T } | { ok: false; erro: string };

const MOTIVO_ERRO: Record<string, string> = {
  usuario_inativo: 'Sua conta está inativa. Fale com o gestor.',
  assunto_curto: 'Escreva um assunto com pelo menos três letras.',
  texto_vazio: 'Escreva o que aconteceu.',
  contato_nao_e_seu: 'Esse contato não está com você.',
  chip_nao_e_seu: 'Esse número não está no seu cadastro.',
  chamado_nao_encontrado: 'Este chamado não existe mais.',
  chamado_nao_e_seu: 'Este chamado não é seu.',
  restrito_ao_gestor: 'Só o gestor pode mudar o estado de um chamado.',
};

const traduz = (motivo?: string) =>
  MOTIVO_ERRO[motivo ?? ''] ?? `Não consegui concluir (${motivo ?? 'erro'}).`;

export async function abrirChamado(entrada: {
  motivo: MotivoChamado;
  assunto: string;
  texto: string;
  contatoId?: string | null;
  chipId?: string | null;
}): Promise<Resposta<{ chamadoId: string }>> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('abrir_chamado', {
    p_motivo: entrada.motivo,
    p_assunto: entrada.assunto,
    p_texto: entrada.texto,
    p_contato_id: entrada.contatoId ?? null,
    p_chip_id: entrada.chipId ?? null,
  });
  if (error) return { ok: false, erro: error.message };

  const r = data as { ok: boolean; motivo?: string; chamado_id?: string };
  if (!r?.ok) return { ok: false, erro: traduz(r?.motivo) };
  return { ok: true, dados: { chamadoId: r.chamado_id! } };
}

export async function responderChamado(chamadoId: string, texto: string): Promise<Resposta> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('responder_chamado', {
    p_chamado_id: chamadoId,
    p_texto: texto,
  });
  if (error) return { ok: false, erro: error.message };
  const r = data as { ok: boolean; motivo?: string };
  return r?.ok ? { ok: true, dados: null } : { ok: false, erro: traduz(r?.motivo) };
}

export async function mudarStatusChamado(
  chamadoId: string,
  status: StatusChamado,
): Promise<Resposta> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('mudar_status_chamado', {
    p_chamado_id: chamadoId,
    p_status: status,
  });
  if (error) return { ok: false, erro: error.message };
  const r = data as { ok: boolean; motivo?: string };
  return r?.ok ? { ok: true, dados: null } : { ok: false, erro: traduz(r?.motivo) };
}

/**
 * Guarda um print no balde PRIVADO `suporte`.
 *
 * ⚠️ Print de conversa carrega nome, telefone e o que o eleitor escreveu. É por
 * isso que o balde não é público e a leitura passa por rota que confere de quem
 * é o chamado: URL de storage público não expira, não esquece e não pergunta
 * quem está abrindo.
 *
 * O caminho leva o id do chamado e um id aleatório — não o nome do arquivo que
 * a pessoa mandou, que costuma ser algo como "WhatsApp Image 2026-08-23 at
 * 14.32.11 - Maria Silva.jpeg" e vazaria um nome no próprio caminho.
 */
export async function enviarAnexo(
  chamadoId: string,
  form: FormData,
): Promise<Resposta<{ anexoId: string }>> {
  const supabase = await criarClienteServidor();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { ok: false, erro: 'Sua sessão expirou. Entre de novo.' };

  const arquivo = form.get('arquivo');
  if (!(arquivo instanceof File)) return { ok: false, erro: 'Nenhum arquivo recebido.' };
  if (arquivo.type !== 'image/webp') {
    return { ok: false, erro: 'O print precisa ser WebP. A conversão acontece no navegador.' };
  }
  if (arquivo.size === 0) return { ok: false, erro: 'O arquivo chegou vazio.' };
  if (arquivo.size > 3 * 1024 * 1024) {
    return { ok: false, erro: 'O print passou de 3 MB depois de convertido.' };
  }

  const largura = Number(form.get('largura')) || null;
  const altura = Number(form.get('altura')) || null;
  const caminho = `${chamadoId}/${crypto.randomUUID()}.webp`;

  const admin = criarClienteAdmin();
  const { error: erroUp } = await admin.storage
    .from('suporte')
    .upload(caminho, arquivo, { contentType: 'image/webp', upsert: false });
  if (erroUp) return { ok: false, erro: `Não consegui guardar o print: ${erroUp.message}` };

  // O registro nasce pela RPC, que confere de quem é o chamado. Se ela recusar,
  // o arquivo sai do balde — arquivo sem dono é print de eleitor esquecido lá.
  const { data, error } = await supabase.rpc('registrar_anexo', {
    p_chamado_id: chamadoId,
    p_caminho: caminho,
    p_bytes: arquivo.size,
    p_largura: largura,
    p_altura: altura,
  });

  const r = data as { ok: boolean; motivo?: string; anexo_id?: string } | null;
  if (error || !r?.ok) {
    await admin.storage.from('suporte').remove([caminho]);
    return { ok: false, erro: error ? error.message : traduz(r?.motivo) };
  }

  return { ok: true, dados: { anexoId: r.anexo_id! } };
}

/** Os chamados que a pessoa pode ver. O RLS já filtra: dono ou gestor. */
export async function listarChamados(): Promise<ChamadoNaLista[]> {
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase
    .from('v_chamados')
    .select('*')
    .order('criado_em', { ascending: false })
    .limit(500);
  if (error) throw new Error(error.message);
  return (data ?? []) as ChamadoNaLista[];
}

export type Conversa = {
  mensagens: { id: string; autor_id: string | null; autor: string | null; texto: string; criado_em: string }[];
  anexos: { id: string; criado_em: string; largura: number | null; altura: number | null }[];
};

export async function carregarConversa(chamadoId: string): Promise<Conversa> {
  const supabase = await criarClienteServidor();
  const [{ data: mensagens }, { data: anexos }] = await Promise.all([
    supabase
      .from('chamado_mensagens')
      .select('id, autor_id, texto, criado_em, usuarios(primeiro_nome)')
      .eq('chamado_id', chamadoId)
      .order('criado_em'),
    supabase
      .from('chamado_anexos')
      .select('id, criado_em, largura, altura')
      .eq('chamado_id', chamadoId)
      .order('criado_em'),
  ]);

  type L = {
    id: string; autor_id: string | null; texto: string; criado_em: string;
    usuarios: { primeiro_nome: string } | { primeiro_nome: string }[] | null;
  };

  return {
    mensagens: ((mensagens ?? []) as unknown as L[]).map((m) => {
      const rel = m.usuarios;
      const nome = Array.isArray(rel) ? rel[0]?.primeiro_nome : rel?.primeiro_nome;
      return { id: m.id, autor_id: m.autor_id, autor: nome ?? null, texto: m.texto, criado_em: m.criado_em };
    }),
    anexos: (anexos ?? []) as Conversa['anexos'],
  };
}
