/**
 * Valida TODOS os textos de mensagem que estão no banco contra o validador de
 * blocos travados.
 *
 * O editor do gestor já valida no salvamento, mas isso não cobre texto que
 * entrou por migration nem regra que mudou depois. Se o validador ficar mais
 * exigente e ninguém revalidar o que já está gravado, o atendente descobre o
 * problema no meio do turno — com a mensagem travando na cara dele.
 */
import { createClient } from '@supabase/supabase-js';
import { config as carregarEnv } from 'dotenv';
import { validarModelo, podeSalvar } from '../src/lib/mensagem';
import type { Etapa } from '../src/lib/mensagem';

carregarEnv({ path: '.env.local', quiet: true });

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false } },
);

const { data, error } = await supabase
  .from('variacoes')
  .select('id, texto, ordem, ativa, modelos(etapa)')
  .eq('ativa', true)
  .order('ordem');

if (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

type Linha = { id: string; texto: string; ordem: number; modelos: { etapa: Etapa } | null };
const variacoes = (data ?? []) as unknown as Linha[];

let bloqueios = 0;
let avisos = 0;

for (const v of variacoes) {
  const etapa = v.modelos?.etapa;
  if (!etapa) continue;

  const problemas = validarModelo(etapa, v.texto);
  if (problemas.length === 0) continue;

  console.log(`\n${etapa} · variação ${v.ordem}`);
  for (const p of problemas) {
    console.log(`  ${p.bloqueia ? '❌' : '⚠️ '} ${p.mensagem}`);
    if (p.bloqueia) bloqueios++;
    else avisos++;
  }
  if (!podeSalvar(problemas)) {
    console.log('     ↳ este texto NÃO poderia ser salvo pelo gestor hoje.');
  }
}

console.log();
if (bloqueios > 0) {
  console.log(`❌ ${bloqueios} problema(s) que impedem salvar, em ${variacoes.length} textos ativos.`);
  process.exit(1);
}
console.log(`✅ ${variacoes.length} textos ativos, nenhum bloqueio${avisos ? ` (${avisos} aviso(s))` : ''}`);
