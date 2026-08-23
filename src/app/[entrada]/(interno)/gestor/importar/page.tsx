import type { Metadata } from 'next';
import { Titulo } from '@/components/ui';
import { Importador } from './importador';

export const metadata: Metadata = { title: 'Importar lista' };

export default function PaginaImportar() {
  return (
    <>
      <Titulo sub="O sistema limpa a planilha e mostra o resultado antes de gravar qualquer coisa.">Importar lista</Titulo>
      <Importador />
    </>
  );
}
