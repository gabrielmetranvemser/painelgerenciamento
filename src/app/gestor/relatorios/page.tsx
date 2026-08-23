import type { Metadata } from 'next';
import { criarClienteServidor } from '@/lib/supabase/server';
import { BotaoLink, Cartao, Vazio } from '@/components/ui';
import type { DesempenhoAtendente, FunilMunicipio, Lista } from '@/lib/tipos-banco';

export const metadata: Metadata = { title: 'Relatórios' };
export const dynamic = 'force-dynamic';

const EXPORTS = [
  ['contatos', 'Todos os contatos', 'Com telefone, situação, atendente e datas.'],
  ['kit', 'Pedidos de kit', 'Nome, endereço e itens — é o que a entrega precisa levar na rua.'],
  ['municipios', 'Por município', 'Abordados, autorizações e cliques por cidade.'],
  ['atendentes', 'Por atendente', 'Volume e resultado de cada pessoa.'],
] as const;

export default async function PaginaRelatorios() {
  const supabase = await criarClienteServidor();

  const [{ data: municipios }, { data: atendentes }, { data: listas }] = await Promise.all([
    supabase.from('v_funil_municipio').select('*').order('contatos', { ascending: false }).limit(60),
    supabase.from('v_desempenho_atendente').select('*').order('total_abordados', { ascending: false }),
    supabase.from('listas').select('*').order('criado_em', { ascending: false }),
  ]);

  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Relatórios</h1>
      <p className="mb-5 text-sm text-suave">
        Os arquivos abrem direto no Excel, com acento certo.
      </p>

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-suave">Exportar</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {EXPORTS.map(([chave, titulo, dica]) => (
            <Cartao key={chave} className="flex flex-col p-4">
              <p className="text-sm font-medium">{titulo}</p>
              <p className="mb-3 mt-0.5 flex-1 text-xs text-suave">{dica}</p>
              <BotaoLink href={`/api/export/${chave}`} variante="neutro" tamanho="p" prefetch={false}>
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

      <section className="mb-8">
        <h2 className="mb-2 text-sm font-medium text-suave">Por atendente</h2>
        {(atendentes ?? []).length === 0 ? (
          <Vazio>Nenhum atendente cadastrado.</Vazio>
        ) : (
          <Tabela
            cabecalhos={['Atendente', 'Hoje', 'Total', 'Autorizaram', 'Saíram', 'Sem resposta', 'Cliques']}
            linhas={((atendentes ?? []) as DesempenhoAtendente[]).map((a) => [
              a.atendente, a.hoje, a.total_abordados, a.autorizou, a.pediu_saida, a.sem_resposta, a.cliques_reais,
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
