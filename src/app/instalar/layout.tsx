import { redirect } from 'next/navigation';
import { usuarioAtual } from '@/lib/sessao';

/**
 * Exige login, mas NÃO exige o termo aceito.
 *
 * Esta é a página que a pessoa abre antes de conseguir trabalhar: ela precisa
 * preparar a máquina primeiro. Barrar aqui por causa do termo criaria um nó —
 * o termo é sobre conduta no atendimento, não sobre instalar extensão.
 */
export default async function LayoutInstalar({ children }: { children: React.ReactNode }) {
  const usuario = await usuarioAtual();
  if (!usuario) redirect('/entrar?proximo=/instalar');
  return <div className="surgir flex min-h-full flex-col">{children}</div>;
}
