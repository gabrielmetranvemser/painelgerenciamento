import Link from "next/link";

/**
 * Placeholder da raiz. Vira redirecionamento para /painel ou /gestor conforme o
 * papel do usuário quando o bloco de autenticação entrar.
 */
export default function Home() {
  return (
    <main className="flex flex-1 items-center justify-center p-8">
      <div className="text-center">
        <h1 className="text-xl font-semibold">Painel</h1>
        <p className="mt-2 text-sm text-neutral-500">Acesso restrito.</p>
        <Link
          href="/entrar"
          className="mt-6 inline-block rounded-lg bg-neutral-900 px-5 py-2.5 text-sm font-medium text-neutral-50 dark:bg-neutral-100 dark:text-neutral-900"
        >
          Entrar
        </Link>
      </div>
    </main>
  );
}
