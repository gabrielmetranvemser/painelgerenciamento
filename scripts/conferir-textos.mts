/**
 * Passa TODOS os textos de mensagem que estão no banco pelo validador.
 *
 * O editor do gestor já aponta o que há enquanto ele digita, mas isso não cobre
 * texto que entrou por migration nem regra que mudou depois.
 *
 * ⚠️ O que DERRUBA este script encolheu junto com as regras: só falha o que
 * sairia quebrado na mão da pessoa (texto vazio, variável que não existe). As
 * regras de conteúdo — declarar a chapa, a frase de parar e apagar, sem link na
 * Permissão — viraram decisão do gestor, e um relatório que reprovasse a
 * escolha dele a cada `npm run test:tudo` seria a mesma trava, só que num lugar
 * onde ele não pode responder. Elas continuam LISTADAS aqui, e é para isso que
 * o resumo do fim existe: para alguém olhar de vez em quando e perguntar se
 * ainda é o que a campanha quer.
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

let quebrados = 0;
let riscos = 0;
let avisos = 0;

const MARCA = { impede: '❌', risco: '🔴', aviso: '⚠️ ' } as const;

for (const v of variacoes) {
  const etapa = v.modelos?.etapa;
  if (!etapa) continue;

  const problemas = validarModelo(etapa, v.texto);
  if (problemas.length === 0) continue;

  console.log(`\n${etapa} · variação ${v.ordem}`);
  for (const p of problemas) {
    console.log(`  ${MARCA[p.nivel]} ${p.mensagem}`);
    if (p.nivel === 'impede') quebrados++;
    else if (p.nivel === 'risco') riscos++;
    else avisos++;
  }
  if (!podeSalvar(problemas)) {
    console.log('     ↳ este texto sai QUEBRADO para a pessoa. Não é escolha de escrita.');
  }
}

console.log();
if (quebrados > 0) {
  console.log(`❌ ${quebrados} texto(s) que sairiam quebrados, em ${variacoes.length} ativos.`);
  process.exit(1);
}

// Risco não derruba: é escolha do gestor, e ele já a viu em vermelho na tela em
// que escreveu. Aqui ela só fica visível para quem revisa a operação.
const resumo = [riscos && `${riscos} em vermelho`, avisos && `${avisos} aviso(s)`]
  .filter(Boolean)
  .join(' · ');
console.log(`✅ ${variacoes.length} textos ativos, nenhum quebrado${resumo ? ` (${resumo})` : ''}`);
