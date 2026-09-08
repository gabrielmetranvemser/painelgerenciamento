import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { AlertTriangle } from 'lucide-react';
import { Aviso, BotaoLink, Cartao, Vazio, Titulo } from '@/components/ui';
import { rotas } from '@/lib/links-internos';
import Link from 'next/link';
import type {
  CargaAtendente, CaptacaoPorCandidato, DesempenhoAtendente, FunilMunicipio, LeadOrfao, Lista,
} from '@/lib/tipos-banco';

export const metadata: Metadata = { title: 'Relatórios' };
export const dynamic = 'force-dynamic';

const EXPORTS = [
  ['contatos', 'Todos os contatos', 'Com telefone, situação, atendente e datas.'],
  ['kit', 'Pedidos de kit', 'Nome, endereço, itens e o que já foi entregue.'],
  ['municipios', 'Por município', 'Abordados, autorizações e cliques por cidade.'],
  ['atendentes', 'Por atendente', 'Volume e resultado de cada pessoa.'],
] as const;

export default async function PaginaRelatorios({ params }: { params: Promise<{ entrada: string }> }) {
  const { entrada } = await params;
  const rt = rotas(entrada);
  const supabase = await criarClienteServidor();

  const [
    { data: municipios }, { data: atendentes }, { data: carga },
    { data: porCandidato }, { data: orfaos }, { data: listas },
  ] = await Promise.all([
    supabase.from('v_funil_municipio').select('*').order('contatos', { ascending: false }).limit(60),
    supabase.from('v_desempenho_atendente').select('*').order('total_abordados', { ascending: false }),
    supabase.from('v_carga_atendente').select('*'),
    supabase.from('v_captacao_por_candidato').select('*').order('cadastros', { ascending: false }),
    supabase.from('v_leads_orfaos').select('*'),
    supabase.from('listas').select('*').order('criado_em', { ascending: false }),
  ]);

  // Carga em aberto, indexada por atendente: v_desempenho conta o que já
  // terminou, e o que trava a operação é justamente o que NÃO terminou.
  const emAberto = new Map(
    ((carga ?? []) as CargaAtendente[]).map((c) => [c.atendente_id, c]),
  );

  return (
    <>
      <Titulo sub="Os arquivos abrem direto no Excel, com acento certo.">Relatórios</Titulo>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-suave">Exportar</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {EXPORTS.map(([chave, titulo, dica]) => (
            <Cartao key={chave} className="flex flex-col p-4">
              <p className="text-sm font-medium">{titulo}</p>
              <p className="mb-3 mt-0.5 flex-1 text-xs text-suave">{dica}</p>
              <BotaoLink href={rt.exportar(chave)} variante="neutro" tamanho="p" prefetch={false}>
                Baixar CSV
              </BotaoLink>
            </Cartao>
          ))}
        </div>
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-suave">Por município</h2>
        {(municipios ?? []).length === 0 ? (
          <Vazio>Nada ainda. Os números aparecem conforme os atendentes trabalham.</Vazio>
        ) : (
          <Tabela
            cabecalhos={['Município', 'Abordados', 'Autorizaram', 'Saíram', 'Querem ajudar', 'Cliques']}
            linhas={((municipios ?? []) as FunilMunicipio[]).map((m) => [
              m.municipio, m.contatos, m.autorizou, m.pediu_saida, m.quer_ajudar, m.cliques_reais,
            ])}
          />
        )}
      </section>

      {(orfaos ?? []).length > 0 && (
        <section className="mb-8">
          <Aviso tom="alerta" icone={<AlertTriangle size={16} />}>
            <strong>Tem lead parado sem ninguém para atender.</strong>{' '}
            {((orfaos ?? []) as LeadOrfao[])
              .map((o) => `${o.nome_urna} (${o.na_fila})`)
              .join(', ')}
            . Esses cadastros chegaram pela página do candidato e a fila não entrega a ninguém,
            porque nenhum atendente ativo atende essa candidatura.{' '}
            <Link href={rt.gestorCandidatos} className="underline underline-offset-4">
              Atribuir atendente
            </Link>
          </Aviso>
        </section>
      )}

      {/* ── Por atendente ───────────────────────────────────────────────────
          A tabela inteira mora em Desempenho, com o recorte por período e a
          tela de cada pessoa. Aqui fica só o topo do ranking: repetir a tabela
          nas duas telas é combinar que um dia elas discordem, e quem estiver
          olhando a errada não tem como saber. */}
      <section className="mb-8">
        <div className="mb-2 flex flex-wrap items-baseline gap-3">
          <h2 className="mr-auto text-sm font-medium text-suave">Por atendente</h2>
          <Link href={rt.gestorDesempenho}
                className="text-xs text-suave underline-offset-4 hover:text-texto hover:underline">
            Abrir o painel de desempenho
          </Link>
        </div>
        {(atendentes ?? []).length === 0 ? (
          <Vazio>Nenhum atendente cadastrado.</Vazio>
        ) : (
          <Cartao className="p-5">
            <p className="mb-4 text-xs leading-relaxed text-suave">
              Quem falou com mais gente, desde o começo. Para o histórico por período, as horas
              de cada dia e a tela de cada pessoa, abra o{' '}
              <Link href={rt.gestorDesempenho} className="underline underline-offset-4">
                painel de desempenho
              </Link>.
            </p>
            <ul className="space-y-2.5">
              {((atendentes ?? []) as DesempenhoAtendente[])
                .filter((a) => a.total_abordados > 0)
                .slice(0, 5)
                .map((a, i, lista) => (
                  <li key={a.atendente_id}>
                    <div className="mb-1 flex items-baseline gap-2">
                      <span className="truncate text-[13px] font-medium">{a.atendente}</span>
                      <span className="truncate text-xs text-suave">
                        {a.autorizou.toLocaleString('pt-BR')} autorizaram
                        {(emAberto.get(a.atendente_id)?.abertos_sem_falar ?? 0) > 0
                          && ` · ${emAberto.get(a.atendente_id)!.abertos_sem_falar} pegou e não falou`}
                      </span>
                      <span className="ml-auto font-display text-sm font-semibold tabular">
                        {a.total_abordados.toLocaleString('pt-BR')}
                      </span>
                    </div>
                    <div className="h-2.5 w-full overflow-hidden rounded-full bg-vidro">
                      <div className="h-full rounded-full bg-acento"
                           style={{
                             width: `${Math.max(2, (a.total_abordados / Math.max(lista[0].total_abordados, 1)) * 100)}%`,
                           }} />
                    </div>
                  </li>
                ))}
            </ul>
          </Cartao>
        )}
      </section>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-suave">Por candidato</h2>
        <p className="mb-2 text-xs text-suave">
          Quanto o link de cada candidatura trouxe, e quanto disso virou conversa de verdade.
        </p>
        {(porCandidato ?? []).length === 0 ? (
          <Vazio>Nenhum candidato cadastrado.</Vazio>
        ) : (
          <Tabela
            cabecalhos={['Candidato', 'Endereço', 'Cadastros', 'Pediram kit', 'Viraram contato', 'Receberam material']}
            linhas={((porCandidato ?? []) as CaptacaoPorCandidato[]).map((c) => [
              c.nome_urna, `/${c.slug}`, c.cadastros, c.pediram_kit, c.viraram_contato, c.receberam_material,
            ])}
          />
        )}
      </section>

      <section>
        <h2 className="mb-2 text-sm font-medium text-suave">Listas importadas</h2>
        {(listas ?? []).length === 0 ? (
          <Vazio>Nenhuma lista importada.</Vazio>
        ) : (
          <Cartao className="divide-y divide-borda">
            {((listas ?? []) as Lista[]).map((l) => (
              <div key={l.id} className="px-4 py-3">
                <p className="text-sm font-medium">
                  {l.rotulo}
                  <span className="ml-2 text-xs font-normal text-suave">
                    {l.origem === 'lista_fria' ? 'fria' : 'quente'}
                  </span>
                </p>
                <p className="text-xs text-suave">
                  {l.total_importados.toLocaleString('pt-BR')} entraram ·{' '}
                  {l.total_duplicados.toLocaleString('pt-BR')} repetidos ·{' '}
                  {l.total_bloqueados.toLocaleString('pt-BR')} bloqueados ·{' '}
                  {l.total_invalidos.toLocaleString('pt-BR')} inválidos
                </p>
                {l.entregue_por && (
                  <p className="mt-0.5 text-xs text-suave">
                    entregue por {l.entregue_por}
                    {l.entregue_em && ` em ${new Date(`${l.entregue_em}T12:00:00`).toLocaleDateString('pt-BR')}`}
                  </p>
                )}
              </div>
            ))}
          </Cartao>
        )}
      </section>
    </>
  );
}

function Tabela({ cabecalhos, linhas }: { cabecalhos: string[]; linhas: (string | number)[][] }) {
  return (
    <Cartao className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-borda text-left">
            {cabecalhos.map((c, i) => (
              <th key={c} className={`px-4 py-2.5 text-xs font-medium text-suave ${i > 0 ? 'text-right' : ''}`}>
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-borda">
          {linhas.map((linha, i) => (
            <tr key={i}>
              {linha.map((celula, j) => (
                <td key={j} className={`px-4 py-2.5 ${j > 0 ? 'text-right tabular-nums' : 'font-medium'}`}>
                  {typeof celula === 'number' ? celula.toLocaleString('pt-BR') : celula}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </Cartao>
  );
}
