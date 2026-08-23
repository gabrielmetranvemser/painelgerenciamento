/**
 * Semeia contatos de teste usando as MESMAS funções de normalização que a
 * importação real usa. Serve para experimentar a tela do atendente antes de
 * existir CSV de verdade.
 *
 *   node scripts/semear-teste.ts
 *   node scripts/semear-teste.ts --limpar
 */
import { createClient } from '@supabase/supabase-js';
import { createHmac } from 'node:crypto';
import { config as carregarEnv } from 'dotenv';
import { normalizarTelefone } from '../src/lib/telefone';
import { primeiroNomeDe } from '../src/lib/mensagem';

carregarEnv({ path: '.env.local', quiet: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const hmac = (chave: string) =>
  createHmac('sha256', process.env.HMAC_SECRET!).update(chave).digest('hex');

if (process.argv.includes('--limpar')) {
  await supabase.from('contatos').delete().like('nome', '[TESTE]%');
  await supabase.from('listas').delete().like('rotulo', '[TESTE]%');
  console.log('✅ contatos de teste removidos');
  process.exit(0);
}

const BRUTOS = [
  ['MARIA DAS GRAÇAS SOUZA', '(69) 99999-0001', 'site'],
  ['joão pedro alves', '69 99999-0002', 'kit'],
  ['ANTONIO C. FERREIRA', '+55 69 9 9999-0003', 'site'],
  ['Rosangela Lima', '6999990004', 'lista_fria'],
  ['JOSE DA SILVA', '069999990005', 'lista_fria'],
  ['Fernanda', '5569999990006', 'lista_fria'],
  ['CARLOS EDUARDO', '69 3221-4567', 'lista_fria'],   // fixo → deve ser rejeitado
  ['Duplicado', '(69) 9999-0001', 'lista_fria'],      // mesmo do primeiro, sem o 9
] as const;

const { data: lista } = await supabase
  .from('listas')
  .insert({
    origem: 'lista_fria',
    rotulo: '[TESTE] semeadura local',
    entregue_por: 'Semeadura de teste',
    entregue_em: new Date().toISOString().slice(0, 10),
    total_linhas: BRUTOS.length,
  })
  .select('id')
  .single();

let importados = 0, invalidos = 0, duplicados = 0;
const vistos = new Set<string>();

for (const [nome, telefone, origem] of BRUTOS) {
  const t = normalizarTelefone(telefone);
  if (!t.valido) {
    console.log(`  ✗ ${telefone.padEnd(20)} rejeitado: ${t.motivo}`);
    invalidos++;
    continue;
  }
  if (vistos.has(t.chaveDedup)) {
    console.log(`  ✗ ${telefone.padEnd(20)} duplicado de outra linha`);
    duplicados++;
    continue;
  }
  vistos.add(t.chaveDedup);

  const { error } = await supabase.from('contatos').insert({
    lista_id: lista!.id,
    origem,
    nome: `[TESTE] ${nome}`,
    primeiro_nome: primeiroNomeDe(nome),
    telefone_e164: t.e164,
    chave_dedup: t.chaveDedup,
    telefone_hmac: hmac(t.chaveDedup),
    status: 'na_fila',
  });

  if (error) {
    console.log(`  ✗ ${telefone.padEnd(20)} ${error.message}`);
    duplicados++;
  } else {
    console.log(`  ✓ ${telefone.padEnd(20)} → ${t.e164}  (${origem})`);
    importados++;
  }
}

await supabase.from('listas')
  .update({ total_importados: importados, total_invalidos: invalidos, total_duplicados: duplicados })
  .eq('id', lista!.id);

console.log(`\n${importados} importados · ${duplicados} duplicados · ${invalidos} inválidos`);
