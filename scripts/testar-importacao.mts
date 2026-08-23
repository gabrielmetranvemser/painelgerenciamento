/**
 * Exercita o pipeline de importação de ponta a ponta, com as MESMAS funções que
 * a tela do gestor usa. Só pula a checagem de sessão.
 *
 *   node scripts/testar-importacao.ts caminho/da/lista.csv
 */
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { config as carregarEnv } from 'dotenv';
import Papa from 'papaparse';
import { analisarLinhas, casarMunicipio, emBlocos, sugerirMapa } from '../src/lib/importacao';

carregarEnv({ path: '.env.local', quiet: true });

const caminho = process.argv[2];
if (!caminho) { console.error('uso: node scripts/testar-importacao.ts <arquivo.csv>'); process.exit(1); }

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);
const hmac = (c: string) => createHmac('sha256', process.env.HMAC_SECRET!).update(c).digest('hex');

// ── 1. Ler e mapear ──────────────────────────────────────────────────────────
const texto = readFileSync(caminho, 'utf8');
const parsed = Papa.parse<Record<string, string>>(texto, { header: true, skipEmptyLines: 'greedy' });
const colunas = parsed.meta.fields ?? [];
const palpite = sugerirMapa(colunas);

console.log(`colunas do arquivo: ${colunas.join(' | ')}`);
console.log(`mapeamento sugerido: telefone=${palpite.telefone}` +
  ('nome' in palpite ? ` nome=${palpite.nome} cidade=${palpite.municipio}` : ''));
if (!palpite.telefone) { console.error('❌ não achou coluna de telefone'); process.exit(1); }

// ── 2. Analisar ──────────────────────────────────────────────────────────────
const a = analisarLinhas(parsed.data, palpite as { nome: string | null; telefone: string; municipio: string | null });
console.log(`\n── análise no navegador ──`);
console.log(`  linhas no arquivo:      ${a.totalLinhas}`);
console.log(`  válidas e únicas:       ${a.validas.length}`);
console.log(`  repetidas no arquivo:   ${a.duplicadasNoArquivo}`);
console.log(`  inválidas:              ${a.invalidas}`);
for (const [motivo, n] of Object.entries(a.porMotivo)) console.log(`      ${motivo.padEnd(14)} ${n}`);

// ── 3. Conferir contra o banco ───────────────────────────────────────────────
let jaExistem = 0, bloqueados = 0;
for (const bloco of emBlocos(a.validas.map((l) => l.chaveDedup), 500)) {
  const hashes = bloco.map(hmac);
  const [{ data: e }, { data: b }] = await Promise.all([
    supabase.from('contatos').select('telefone_hmac').in('telefone_hmac', hashes),
    supabase.from('bloqueios').select('telefone_hmac').in('telefone_hmac', hashes),
  ]);
  const setB = new Set((b ?? []).map((x) => x.telefone_hmac));
  jaExistem += (e ?? []).filter((x) => !setB.has(x.telefone_hmac)).length;
  bloqueados += setB.size;
}
console.log(`\n── conferência contra o banco ──`);
console.log(`  já estão na base:       ${jaExistem}`);
console.log(`  bloqueados:             ${bloqueados}`);
console.log(`  VÃO ENTRAR NA FILA:     ${a.validas.length - jaExistem - bloqueados}`);

// ── 4. Importar ──────────────────────────────────────────────────────────────
const { data: lista, error: erroLista } = await supabase.from('listas').insert({
  origem: 'lista_fria',
  rotulo: '[TESTE] lista suja 503 linhas',
  entregue_por: 'Teste automatizado',
  entregue_em: new Date().toISOString().slice(0, 10),
  arquivo_nome: caminho.split('/').pop(),
  total_linhas: a.totalLinhas,
}).select('id').single();

if (erroLista) { console.error(`❌ ${erroLista.message}`); process.exit(1); }

const { data: municipios } = await supabase.from('municipios').select('id, nome');
let importados = 0, duplicados = 0;

for (const bloco of emBlocos(a.validas, 500)) {
  const comHash = bloco.map((l) => ({ ...l, hash: hmac(l.chaveDedup) }));
  const { data: bl } = await supabase.from('bloqueios').select('telefone_hmac')
    .in('telefone_hmac', comHash.map((l) => l.hash));
  const setB = new Set((bl ?? []).map((x) => x.telefone_hmac));

  const paraInserir = comHash.filter((l) => !setB.has(l.hash)).map((l) => ({
    lista_id: lista.id, origem: 'lista_fria' as const,
    nome: l.nome, primeiro_nome: l.primeiroNome,
    telefone_e164: l.e164, chave_dedup: l.chaveDedup,
    telefone_hmac: l.hash, hmac_versao: 1,
    municipio_id: casarMunicipio(l.municipioNome, municipios ?? []),
    status: 'na_fila' as const,
  }));

  const { data, error } = await supabase.from('contatos')
    .upsert(paraInserir, { onConflict: 'telefone_hmac', ignoreDuplicates: true }).select('id');
  if (error) { console.error(`❌ ${error.message}`); process.exit(1); }
  importados += data?.length ?? 0;
  duplicados += paraInserir.length - (data?.length ?? 0);
}

await supabase.from('listas').update({
  total_importados: importados, total_duplicados: duplicados + a.duplicadasNoArquivo,
  total_bloqueados: bloqueados, total_invalidos: a.invalidas,
}).eq('id', lista.id);

console.log(`\n── gravado ──`);
console.log(`  importados:             ${importados}`);
console.log(`  ignorados (já existiam):${duplicados}`);
