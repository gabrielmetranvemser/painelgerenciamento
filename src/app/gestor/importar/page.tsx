import type { Metadata } from 'next';
import { Importador } from './importador';

export const metadata: Metadata = { title: 'Importar lista' };

export default function PaginaImportar() {
  return (
    <>
      <h1 className="mb-1 text-xl font-semibold">Importar lista</h1>
      <p className="mb-5 text-sm text-suave">
        O sistema limpa a planilha e mostra o resultado antes de gravar qualquer coisa.
      </p>
      <Importador />
    </>
  );
}
