#!/usr/bin/env node
/**
 * Compara as colunas do banco com os tipos escritos à mão em
 * src/lib/tipos-banco.ts.
 *
 * Existe porque `supabase gen types` exige Docker e esta máquina não tem, então
 * os tipos são mantidos na mão — e tipo na mão silenciosamente desatualiza.
 * Rode depois de qualquer migration:  npm run tipos
 */
import { readFileSync } from 'node:fs';
import { config as carregarEnv } from 'dotenv';
import pg from 'pg';

carregarEnv({ path: '.env.local', quiet: true });

const TABELAS = {
  config: 'Config', usuarios: 'Usuario', chips: 'Chip', listas: 'Lista',
  contatos: 'Contato', interacoes: 'Interacao', modelos: 'Modelo',
  variacoes: 'Variacao', links: 'Link',
  municipios: 'Municipio', dias_bloqueados: 'DiaBloqueado',
  alertas: 'Alerta', captacoes: 'Captacao',
  candidatos: 'Candidato', materiais: 'Material',
  atendente_candidatos: 'AtendenteCandidato', contato_candidato: 'ContatoCandidato',
  atendente_listas: 'AtendenteLista',
  itens_kit: 'ItemDeKit', comites: 'ComiteDoCandidato',
  contato_correcoes: 'CorrecaoDeContato', modelos_livres: 'ModeloLivre',
  chamados: 'Chamado', chamado_mensagens: 'ChamadoMensagem', chamado_anexos: 'ChamadoAnexo',
};

const cliente = new pg.Client({ connectionString: process.env.SUPABASE_DB_URL });
await cliente.connect();

const { rows } = await cliente.query(`
  select table_name, column_name
    from information_schema.columns
   where table_schema = 'public' and table_name = any($1)
   order by table_name, ordinal_position`,
  [Object.keys(TABELAS)]);
await cliente.end();

const fonte = readFileSync('src/lib/tipos-banco.ts', 'utf8');
const blocos = new Map();
for (const [tabela, tipo] of Object.entries(TABELAS)) {
  const m = fonte.match(new RegExp(`export type ${tipo} = \\{([\\s\\S]*?)\\n\\};`));
  blocos.set(tabela, m ? m[1] : null);
}

let faltando = 0;
for (const { table_name, column_name } of rows) {
  const bloco = blocos.get(table_name);
  if (bloco === null) { console.log(`⚠️  tipo de ${table_name} não encontrado`); continue; }
  if (!new RegExp(`\\b${column_name}\\??:`).test(bloco)) {
    console.log(`❌ ${TABELAS[table_name]} não tem "${column_name}" (tabela ${table_name})`);
    faltando++;
  }
}

if (faltando > 0) {
  console.log(`\n${faltando} coluna(s) sem tipo. Atualize src/lib/tipos-banco.ts.`);
  process.exit(1);
}
console.log('✅ tipos em dia com o banco');
