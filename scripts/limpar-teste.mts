/**
 * Apaga TODOS os dados de operação, deixando a base pronta para valer.
 *
 * Preserva o que é configuração: usuários, chips, municípios, modelos de
 * mensagem, destinos e a config da campanha.
 *
 * Apaga: contatos, listas, interações, links, cliques, captações, alertas e
 * bloqueios.
 *
 * ⚠️ Apagar `bloqueios` significa que quem pediu saída ANTES desta limpeza
 *    volta a ser abordável. Só rode antes de a operação começar de verdade.
 *
 *   npm run limpar:teste -- --confirmo
 */
import { createClient } from '@supabase/supabase-js';
import { config as carregarEnv } from 'dotenv';

carregarEnv({ path: '.env.local', quiet: true });

if (!process.argv.includes('--confirmo')) {
  console.error('Isto apaga contatos, listas, interações, cliques e bloqueios.');
  console.error('Se é isso mesmo:  npm run limpar:teste -- --confirmo');
  process.exit(1);
}

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

// Ordem importa: filhos antes dos pais.
const TABELAS = [
  'cliques', 'links', 'interacoes', 'captacoes',
  'alertas', 'contatos', 'listas', 'bloqueios', 'rotacao_chip',
];

for (const tabela of TABELAS) {
  const { count } = await supabase.from(tabela).select('*', { count: 'exact', head: true });
  // `.gte` num campo sempre presente é o jeito do PostgREST de dizer "todas".
  const { error } = await supabase.from(tabela).delete().gte('criado_em', '1900-01-01');
  if (error) {
    // cliques usa `ts`, rotacao_chip usa `atualizado_em`
    const alt = tabela === 'cliques' ? 'ts' : 'atualizado_em';
    const { error: e2 } = await supabase.from(tabela).delete().gte(alt, '1900-01-01');
    if (e2) { console.error(`❌ ${tabela}: ${e2.message}`); continue; }
  }
  console.log(`  ${tabela.padEnd(14)} ${count ?? 0} removidos`);
}

console.log('\n✅ base limpa. Configuração, usuários, chips e mensagens preservados.');
