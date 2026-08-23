#!/usr/bin/env node
/**
 * Cria uma conta de acesso ao painel.
 *
 * Ninguém se cadastra sozinho: o gestor cria as contas. Este script existe para
 * o primeiro gestor (que não tem quem o crie) e para o suporte. Do segundo em
 * diante, use a tela Gestor → Atendentes.
 *
 *   node scripts/criar-usuario.mjs <email> <primeiro-nome> [gestor|atendente]
 */
import { createClient } from '@supabase/supabase-js';
import { randomBytes } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { config as carregarEnv } from 'dotenv';

// Node puro não lê .env.local sozinho (isso é coisa do Next).
carregarEnv({ path: '.env.local', quiet: true });

const [email, primeiroNome, papel = 'atendente'] = process.argv.slice(2);

if (!email || !primeiroNome) {
  console.error('uso: node scripts/criar-usuario.mjs <email> <primeiro-nome> [gestor|atendente]');
  process.exit(1);
}
if (!['gestor', 'atendente'].includes(papel)) {
  console.error(`papel inválido: ${papel}. Use "gestor" ou "atendente".`);
  process.exit(1);
}

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const chave = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !chave) {
  console.error('Faltam NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY no .env.local');
  process.exit(1);
}

const supabase = createClient(url, chave, { auth: { persistSession: false } });

// Senha legível ao telefone: o gestor vai ditar isso para 15 pessoas.
const senha = `${randomBytes(4).toString('hex')}-${randomBytes(3).toString('hex')}`;

const { data, error } = await supabase.auth.admin.createUser({
  email,
  password: senha,
  email_confirm: true, // não há fluxo de e-mail; o gestor entrega a senha
});

if (error) {
  console.error(`❌ ${error.message}`);
  process.exit(1);
}

const { error: erroPerfil } = await supabase.from('usuarios').insert({
  id: data.user.id,
  papel,
  primeiro_nome: primeiroNome,
});

if (erroPerfil) {
  // Não deixa usuário órfão no auth: sem linha em `usuarios` ele loga e não
  // consegue fazer nada, o que é pior de diagnosticar do que não existir.
  await supabase.auth.admin.deleteUser(data.user.id);
  console.error(`❌ ${erroPerfil.message}`);
  process.exit(1);
}

const linha = `${new Date().toISOString()}  ${papel.padEnd(9)}  ${email.padEnd(34)}  ${senha}\n`;
appendFileSync('.credenciais-iniciais.txt', linha);

console.log(`✅ ${papel} criado: ${email}`);
console.log(`   senha: ${senha}`);
console.log(`   (também anotada em .credenciais-iniciais.txt, que está fora do git)`);
