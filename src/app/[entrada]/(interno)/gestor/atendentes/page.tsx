import type { Metadata } from 'next';
import { Aviso, Titulo } from '@/components/ui';
import { criarClienteServidor } from '@/lib/supabase/server';
import type { Candidato, CargoEleitoral, Usuario } from '@/lib/tipos-banco';
import type { ItemChapa } from './chapa-do-atendente';
import type { ItemLista } from './listas-do-atendente';
import { GerenciarAtendentes } from './lista';
import { contatosSemCandidato, emailsDasContas } from './acoes';

export const metadata: Metadata = { title: 'Atendentes' };
export const dynamic = 'force-dynamic';

export default async function PaginaAtendentes({ params }: { params: Promise<{ entrada: string }> }) {
  const { entrada } = await params;
  const supabase = await criarClienteServidor();
  const [{ data }, { data: candidatos }, { data: atribuicoes, error: erroChapas }, { data: listas }, { data: deListas }] =
    await Promise.all([
      supabase.from('usuarios').select('*').order('papel').order('primeiro_nome'),
      supabase.from('candidatos').select('*').order('cargo').order('nome_urna'),
      supabase
        .from('atendente_candidatos')
        // ⚠️ O nome da chave estrangeira é OBRIGATÓRIO aqui.
        //
        // `atendente_candidatos` aponta para `candidatos` DUAS vezes: por
        // `candidato_id` e pela chave composta `(candidato_id, cargo, vaga)`,
        // que é o que sustenta a regra "um candidato por cargo". Com duas FKs,
        // o PostgREST se recusa a adivinhar e devolve PGRST201 — e como o erro
        // era descartado, esta tela mostrou "Sem candidato" para TODOS os
        // atendentes, inclusive os que tinham chapa. O gestor então atribuía de
        // novo, tarde demais, e quem já tinha sido abordado ficava sem material
        // para sempre (o consentimento congela na primeira mensagem).
        .select(
          'atendente_id, candidato_id, cargo, vaga, principal, ' +
          'candidatos!atendente_candidatos_candidato_id_fkey(nome_urna, numero)',
        ),
      supabase.from('listas').select('id, rotulo, origem, ativa').order('criado_em', { ascending: false }),
      supabase.from('atendente_listas').select('atendente_id, lista_id'),
    ]);

  // O e-mail vive em `auth.users`, fora do alcance do PostgREST — vem por ação
  // de servidor, com a chave de serviço.
  const emails = await emailsDasContas();

  // Quem foi abordado antes de ter candidato atribuído. O material dessas
  // pessoas fica travado para sempre até o gestor decidir o que fazer — ver
  // `contatosSemCandidato`.
  const orfaos = await contatosSemCandidato();
  const orfaosPorAtendente = Object.fromEntries(orfaos.map((o) => [o.atendente_id, o]));

  type Bruta = {
    atendente_id: string; candidato_id: string; cargo: CargoEleitoral;
    vaga: number; principal: boolean;
    candidatos: { nome_urna: string; numero: string } | { nome_urna: string; numero: string }[] | null;
  };

  const chapas: Record<string, ItemChapa[]> = {};
  for (const a of ((atribuicoes ?? []) as unknown as Bruta[])) {
    // O PostgREST devolve o relacionamento como lista, mesmo sendo 1:1.
    const rel = Array.isArray(a.candidatos) ? a.candidatos[0] : a.candidatos;
    (chapas[a.atendente_id] ??= []).push({
      candidato_id: a.candidato_id, cargo: a.cargo, vaga: a.vaga,
      principal: a.principal,
      nome: rel?.nome_urna ?? '—', numero: rel?.numero ?? '',
    });
  }
  for (const lista of Object.values(chapas)) {
    lista.sort((x, y) => Number(y.principal) - Number(x.principal));
  }

  const listasPorAtendente: Record<string, string[]> = {};
  for (const a of deListas ?? []) {
    (listasPorAtendente[a.atendente_id] ??= []).push(a.lista_id);
  }

  return (
    <>
      <Titulo sub="Quem desativar perde o acesso na hora e some da fila. Os contatos que estavam com a pessoa voltam para a fila quando o prazo de 20 minutos vencer.">Atendentes</Titulo>

      {/* Tela vazia por erro de leitura é indistinguível de tela vazia por não
          haver dado — e foi essa confusão que fez o gestor reatribuir chapas
          que já existiam. Se a leitura falhou, a tela diz. */}
      {erroChapas && (
        <Aviso tom="erro" className="mb-5">
          <strong>Não consegui ler as chapas.</strong> O que aparece abaixo como
          &ldquo;sem candidato&rdquo; pode estar errado — não reatribua nada até isto
          voltar ao normal. Detalhe técnico: {erroChapas.message}
        </Aviso>
      )}

      <GerenciarAtendentes
        usuarios={(data ?? []) as Usuario[]}
        entrada={entrada}
        candidatos={(candidatos ?? []) as Candidato[]}
        chapas={chapas}
        listas={(listas ?? []) as ItemLista[]}
        listasPorAtendente={listasPorAtendente}
        emails={emails}
        orfaos={orfaosPorAtendente}
      />
    </>
  );
}
