#!/usr/bin/env node
/**
 * Procura o erro que derrubou a tela de Contatos em produção:
 * **Server Component importando VALOR de um arquivo `'use client'`.**
 *
 * O que acontece: tudo que um módulo `'use client'` exporta chega ao servidor
 * como uma REFERÊNCIA para o cliente, não como o valor. Para componente é assim
 * de propósito — é o que o servidor manda o navegador montar. Para um array,
 * não: ele vira um objeto que não é array, e `RECORTES.some` deixa de existir.
 *
 * Por que precisa de um script: nada mais pega. O TypeScript vê os dois lados
 * como o mesmo módulo e aprova; o `next build` compila; o erro só aparece
 * quando alguém abre a página — em produção, com sessão, que é justamente o
 * caminho que não dá para testar aqui.
 *
 * ⚠️ A regra é uma HEURÍSTICA, e ela é assumida: nome em PascalCase passa
 * (componente vindo do cliente é o caso legítimo e comum), qualquer outro é
 * apontado. Um `type` importado nunca conta — tipo some na compilação.
 *
 * Se algum dia der um falso positivo, o jeito certo de calar não é afrouxar o
 * script: é mover a constante para um arquivo neutro, que é o conserto de
 * qualquer forma.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, dirname, resolve, relative } from 'node:path';

const RAIZ = resolve(import.meta.dirname, '..');
const SRC = join(RAIZ, 'src');

function arquivos(dir) {
  return readdirSync(dir).flatMap((nome) => {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) return arquivos(caminho);
    return /\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome) ? [caminho] : [];
  });
}

const todos = arquivos(SRC);
const fonte = new Map(todos.map((f) => [f, readFileSync(f, 'utf8')]));

/** A diretiva vale só se estiver no topo do arquivo, antes de qualquer código. */
const ehCliente = (texto) => /^\s*(?:\/\*[\s\S]*?\*\/\s*|\/\/.*\n\s*)*['"]use client['"]/.test(texto);
const clientes = new Set(todos.filter((f) => ehCliente(fonte.get(f))));

/** Resolve o especificador para um arquivo do projeto, com as extensões do Next. */
function resolver(de, especificador) {
  const base = especificador.startsWith('@/')
    ? join(SRC, especificador.slice(2))
    : especificador.startsWith('.')
      ? resolve(dirname(de), especificador)
      : null;
  if (base === null) return null;

  for (const tentativa of [
    `${base}.tsx`, `${base}.ts`,
    join(base, 'index.tsx'), join(base, 'index.ts'),
  ]) {
    if (fonte.has(tentativa)) return tentativa;
  }
  return null;
}

const RE_IMPORT = /import\s+(type\s+)?({[^}]*}|[\w$]+)[^'"]*from\s*['"]([^'"]+)['"]/g;

const achados = [];

for (const arquivo of todos) {
  if (clientes.has(arquivo)) continue; // cliente importando cliente é normal

  const texto = fonte.get(arquivo);
  for (const [, tipoNoImport, ligacoes, especificador] of texto.matchAll(RE_IMPORT)) {
    if (tipoNoImport) continue; // `import type { … }` some na compilação

    const alvo = resolver(arquivo, especificador);
    if (alvo === null || !clientes.has(alvo)) continue;

    const nomes = ligacoes.startsWith('{')
      ? ligacoes.slice(1, -1).split(',').map((n) => n.trim()).filter(Boolean)
      : [ligacoes.trim()];

    for (const nome of nomes) {
      if (nome.startsWith('type ')) continue;          // `{ type Filtros }`
      const local = nome.split(/\s+as\s+/).pop().trim();
      if (/^[A-Z][A-Za-z0-9]*$/.test(local)) continue; // componente: o caso legítimo
      achados.push({ arquivo, alvo, nome: local });
    }
  }
}

if (achados.length > 0) {
  console.log('❌ Server Component importando valor de arquivo \'use client\':\n');
  for (const a of achados) {
    console.log(`   ${relative(RAIZ, a.arquivo)}`);
    console.log(`     importa "${a.nome}" de ${relative(RAIZ, a.alvo)}`);
    console.log('     → no servidor isso não é o valor, é uma referência para o cliente.');
    console.log('       Mova para um arquivo SEM \'use client\', que os dois lados importam.\n');
  }
  process.exit(1);
}

console.log(`✅ fronteira servidor/cliente limpa em ${todos.length} arquivos`);
