'use server';

import { revalidarInterno } from '@/lib/revalidar';
import { z } from 'zod';
import { criarClienteAdmin } from '@/lib/supabase/admin';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestorOuFalhar, gerarSenha } from '@/lib/gestor';

const Novo = z.object({
  email: z.email('E-mail inválido.'),
  primeiroNome: z.string().trim().min(2, 'Escreva o primeiro nome.').max(40),
  papel: z.enum(['atendente', 'gestor']),
});

export type ResultadoNovo =
  | { ok: true; email: string; senha: string }
  | { ok: false; erro: string };

/**
 * Cria a conta de um atendente. Ninguém se cadastra sozinho.
 * A senha é mostrada UMA vez: não guardamos senha em lugar nenhum.
 */
export async function criarAtendente(_anterior: ResultadoNovo | null, form: FormData): Promise<ResultadoNovo> {
  await exigirGestorOuFalhar();

  const analise = Novo.safeParse({
    email: String(form.get('email') ?? '').trim().toLowerCase(),
    primeiroNome: form.get('primeiro_nome'),
    papel: form.get('papel') ?? 'atendente',
  });
  if (!analise.success) return { ok: false, erro: analise.error.issues[0].message };

  const { email, primeiroNome, papel } = analise.data;
  const senha = gerarSenha();
  const supabase = criarClienteAdmin();

  const { data, error } = await supabase.auth.admin.createUser({
    email,
    password: senha,
    email_confirm: true, // não há fluxo de e-mail: o gestor entrega a senha
  });

  if (error) {
    return {
      ok: false,
      erro: error.message.includes('already')
        ? 'Já existe uma conta com esse e-mail.'
        : error.message,
    };
  }

  const { error: erroPerfil } = await supabase
    .from('usuarios')
    .insert({ id: data.user.id, papel, primeiro_nome: primeiroNome });

  if (erroPerfil) {
    // Sem linha em `usuarios`, a pessoa loga e não consegue fazer nada — pior
    // de diagnosticar do que a conta não existir.
    await supabase.auth.admin.deleteUser(data.user.id);
    return { ok: false, erro: erroPerfil.message };
  }

  revalidarInterno('/gestor/atendentes');
  return { ok: true, email, senha };
}

export async function alternarAtivo(id: string, ativo: boolean) {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  await supabase.from('usuarios').update({ ativo }).eq('id', id);
  revalidarInterno('/gestor/atendentes');
}

/** Nova senha para quem esqueceu. Mostrada uma vez. */
export async function redefinirSenha(id: string): Promise<{ ok: boolean; senha?: string }> {
  await exigirGestorOuFalhar();
  const senha = gerarSenha();
  const supabase = criarClienteAdmin();
  const { error } = await supabase.auth.admin.updateUserById(id, { password: senha });
  return error ? { ok: false } : { ok: true, senha };
}

export type ResultadoRenomear = { ok: true } | { ok: false; erro: string };

/**
 * Troca o e-mail de acesso de uma conta.
 *
 * ⚠️ É por onde a pessoa ENTRA. A troca vale na hora: quem já está logado
 * continua na sessão até ela vencer, mas o e-mail antigo para de funcionar no
 * login seguinte. A tela avisa antes.
 *
 * Mora em `auth.users`, fora do alcance do PostgREST — por isso a chave de
 * serviço, o mesmo caminho de `emailsDasContas`.
 *
 * `email_confirm: true` porque não existe fluxo de e-mail neste projeto: quem
 * entrega o acesso é o gestor, na mão. Sem isso a conta ficaria esperando uma
 * confirmação que ninguém vai clicar.
 */
export async function trocarEmail(id: string, email: string): Promise<ResultadoRenomear> {
  await exigirGestorOuFalhar();

  const analise = z.email('E-mail inválido.').safeParse(email.trim().toLowerCase());
  if (!analise.success) return { ok: false, erro: analise.error.issues[0].message };

  const supabase = criarClienteAdmin();
  const { error } = await supabase.auth.admin.updateUserById(id, {
    email: analise.data,
    email_confirm: true,
  });

  if (error) {
    return {
      ok: false,
      erro: error.message.includes('already') || error.message.includes('been registered')
        ? 'Já existe uma conta com esse e-mail.'
        : error.message,
    };
  }

  revalidarInterno('/gestor/atendentes');
  return { ok: true };
}

/**
 * Troca o primeiro nome de quem já está cadastrado.
 *
 * ⚠️ Não é só rótulo de tela: é o nome que a PESSOA DO OUTRO LADO lê. A
 * primeira mensagem diz "Aqui é o Lucas", e a partir do próximo envio ela passa
 * a dizer o nome novo — quem já foi abordado continua com o antigo no histórico
 * da conversa dele, e é por isso que a tela avisa antes.
 *
 * O limite de 2 a 40 caracteres é `check` da tabela; aqui a validação existe
 * para o erro sair em português em vez de "violates check constraint".
 */
export async function renomearAtendente(id: string, primeiroNome: string): Promise<ResultadoRenomear> {
  await exigirGestorOuFalhar();

  const nome = primeiroNome.trim();
  if (nome.length < 2) return { ok: false, erro: 'Escreva o primeiro nome (pelo menos 2 letras).' };
  if (nome.length > 40) return { ok: false, erro: 'Nome muito longo (máximo 40 caracteres).' };

  const supabase = criarClienteAdmin();
  const { error } = await supabase.from('usuarios').update({ primeiro_nome: nome }).eq('id', id);
  if (error) return { ok: false, erro: error.message };

  revalidarInterno('/gestor/atendentes');
  return { ok: true };
}

/**
 * O e-mail de cada conta, que é por onde a pessoa entra.
 *
 * ⚠️ Ele mora em `auth.users`, não em `public.usuarios` — a tela do gestor não
 * tinha como mostrá-lo, e quem perdia o e-mail de um atendente ficava sem saber
 * qual conta redefinir.
 *
 * `listUsers` vem paginado e o padrão é 50 por página: com a equipe crescendo,
 * pedir uma página só faria os últimos sumirem da tela em silêncio — o mesmo
 * defeito do corte de 1.000 linhas do PostgREST. Por isso o laço, que avança
 * enquanto vier página cheia.
 */
export async function emailsDasContas(): Promise<Record<string, string>> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();

  const POR_PAGINA = 200;
  const emails: Record<string, string> = {};

  for (let pagina = 1; pagina <= 50; pagina++) {
    const { data, error } = await supabase.auth.admin.listUsers({ page: pagina, perPage: POR_PAGINA });
    if (error) throw new Error(error.message);

    for (const u of data.users) {
      if (u.email) emails[u.id] = u.email;
    }
    if (data.users.length < POR_PAGINA) break;
  }

  return emails;
}

// ── Consentimento congelado sem chapa ────────────────────────────────────────

export type OrfaoDeChapa = {
  atendente_id: string;
  primeiro_nome: string;
  contatos: number;
  tem_chapa: boolean;
};

/**
 * Quem foi abordado antes de o atendente ter candidato atribuído.
 *
 * `registrar_abertura` congela em `contato_candidato` a chapa do atendente no
 * instante da primeira mensagem, e é essa cópia que autoriza o material depois.
 * Com a chapa vazia, a cópia nasceu vazia — e nada a preenche mais tarde, de
 * propósito: senão um candidato atribuído hoje alcançaria quem autorizou ontem
 * sem nunca ter ouvido o nome dele.
 *
 * O resultado prático é que essas pessoas ficam sem material para sempre, e a
 * tela do atendente diz "não há candidato liberado" mesmo com a chapa montada.
 * Aconteceu em 27/08/2026 com onze contatos.
 */
export async function contatosSemCandidato(): Promise<OrfaoDeChapa[]> {
  await exigirGestorOuFalhar();
  const supabase = criarClienteAdmin();
  const { data, error } = await supabase.rpc('contatos_sem_candidato_declarado');
  if (error) throw new Error(error.message);
  return (data ?? []) as OrfaoDeChapa[];
}

export type ResultadoReparo =
  | { ok: true; contatos: number }
  | { ok: false; erro: string };

/**
 * Declara a chapa atual do atendente para os contatos dele que ficaram órfãos.
 *
 * ⚠️ Isto CONTORNA o congelamento do consentimento, que é a trava mais séria do
 * sistema. Por isso é só do gestor, deixa alerta no banco, e marca cada linha
 * com `declarado_em_reparo` — que é o que faz a tela do atendente pedir a ele
 * que se apresente antes de mandar o material.
 *
 * A chamada vai com a chave de serviço porque a RPC confere `is_gestor()`
 * usando `auth.uid()`... e é por isso que ela NÃO pode ir com service_role.
 * Vai com a sessão, então.
 */
export async function repararConsentimento(atendenteId: string): Promise<ResultadoReparo> {
  await exigirGestorOuFalhar();
  const supabase = await criarClienteServidor();
  const { data, error } = await supabase.rpc('declarar_candidatos_pendentes', {
    p_atendente_id: atendenteId,
  });
  if (error) return { ok: false, erro: error.message };

  const r = data as { ok: boolean; motivo?: string; contatos?: number };
  if (!r.ok) {
    return {
      ok: false,
      erro: r.motivo === 'atendente_sem_chapa'
        ? 'Monte a chapa deste atendente primeiro — sem candidato não há o que declarar.'
        : 'Só o gestor pode fazer isso.',
    };
  }

  revalidarInterno('/gestor/atendentes');
  return { ok: true, contatos: r.contatos ?? 0 };
}
