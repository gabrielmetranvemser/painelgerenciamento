import Link from 'next/link';
import {
  Contact, FileBarChart, Gauge, Headphones, Layers, LifeBuoy, LogOut, MessageSquareText,
  PackageOpen, Settings, Smartphone, Upload, Users, Vote,
} from 'lucide-react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { exigirGestor } from '@/lib/sessao';
import { rotas } from '@/lib/links-internos';
import { sair } from '@/app/[entrada]/(interno)/entrar/acoes';
import { Avatar } from '@/components/ui';
import { MenuLateral, type GrupoMenu } from '@/components/menu-lateral';

/**
 * Os grupos existem porque onze itens numa lista corrida obrigam a ler todos
 * para achar um. Agrupados, a pessoa lê só o grupo — e os nomes dos grupos são
 * as perguntas que o gestor faz, não as tabelas do banco.
 */
export default async function LayoutGestor({
  children, params,
}: {
  children: React.ReactNode;
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const gestor = await exigirGestor(entrada);
  const r = rotas(entrada);

  // O contador do menu: o que está esperando alguém olhar. Sem ele, o gestor
  // só descobre um risco jurídico se lembrar de abrir a tela.
  const supabase = await criarClienteServidor();
  const [{ data: resumo }, { count: semLista }, { count: semChapa }, { count: encaminhados }] =
    await Promise.all([
    supabase
      .from('v_resumo')
      .select('chamados_abertos, juridicos_abertos, alertas_abertos')
      .single(),
    // Atendente ativo sem nenhuma lista não recebe contato de lista nenhuma —
    // ele fica sentado o turno inteiro achando que a base acabou. O número no
    // menu é o que faz o gestor descobrir isso antes do atendente.
    supabase.from('v_atendentes_sem_lista').select('id', { count: 'exact', head: true }),
    // ⚠️ Atendente sem CHAPA é pior que sem lista: a fila recusa com
    // `sem_candidato`, e antes desta trava ele conseguia abordar pessoas com
    // uma primeira mensagem que não dizia de quem era o material. Onze contatos
    // ficaram assim em 27/08.
    supabase.from('v_atendentes_sem_chapa').select('id', { count: 'exact', head: true }),
    // Pedidos que a pessoa fez e o atendente prometeu levar à equipe. Sem este
    // número, o gestor só descobre que existem se lembrar de abrir a aba.
    supabase
      .from('v_contatos_gestor')
      .select('id', { count: 'exact', head: true })
      .not('encaminhamento', 'is', null)
      .is('encaminhamento_tratado_em', null),
  ]);

  const chamados = resumo?.chamados_abertos ?? 0;
  const juridicos = resumo?.juridicos_abertos ?? 0;
  const avisos = chamados + (resumo?.alertas_abertos ?? 0);

  const grupos: GrupoMenu[] = [
    {
      titulo: 'Acompanhar',
      itens: [
        { href: r.gestor, rotulo: 'Visão geral', icone: <Gauge size={15} /> },
        {
          href: r.gestorContatos,
          rotulo: 'Contatos',
          icone: <Contact size={15} />,
          aviso: encaminhados ?? 0,
        },
        {
          href: r.gestorSuporte,
          rotulo: 'Suporte',
          icone: <LifeBuoy size={15} />,
          aviso: avisos,
          // Vermelho só quando há risco jurídico: se tudo pisca, nada pisca.
          urgente: juridicos > 0,
        },
        { href: r.gestorRelatorios, rotulo: 'Relatórios', icone: <FileBarChart size={15} /> },
      ],
    },
    {
      titulo: 'Campanha',
      itens: [
        { href: r.gestorCandidatos, rotulo: 'Candidatos', icone: <Vote size={15} /> },
        { href: r.gestorMensagens, rotulo: 'Mensagens', icone: <MessageSquareText size={15} /> },
        { href: r.gestorEntregas, rotulo: 'Entregas', icone: <PackageOpen size={15} /> },
      ],
    },
    {
      titulo: 'Equipe',
      itens: [
        {
          href: r.gestorAtendentes,
          rotulo: 'Atendentes',
          icone: <Users size={15} />,
          // Os dois somam: as duas coisas mandam o gestor para a mesma tela e
          // têm a mesma cara para o atendente — ele fica sentado achando que a
          // base acabou.
          aviso: (semLista ?? 0) + (semChapa ?? 0),
          // Sem chapa o atendente não trabalha de jeito nenhum. Sem lista, ele
          // ainda recebe quem se cadastrou sozinho.
          urgente: (semChapa ?? 0) > 0,
        },
        { href: r.gestorChips, rotulo: 'Números', icone: <Smartphone size={15} /> },
      ],
    },
    {
      titulo: 'Base',
      itens: [
        { href: r.gestorListas, rotulo: 'Listas', icone: <Layers size={15} /> },
        { href: r.gestorImportar, rotulo: 'Importar', icone: <Upload size={15} /> },
        { href: r.gestorConfiguracao, rotulo: 'Configuração', icone: <Settings size={15} /> },
      ],
    },
  ];

  const rodape = (
    <div className="flex items-center gap-2">
      <Avatar nome={gestor.primeiro_nome} fotoUrl={gestor.foto_url} tamanho="p" />
      <span className="mr-auto hidden min-w-0 truncate text-sm font-medium lg:block">
        {gestor.primeiro_nome}
      </span>
      <Link href={r.painel} title="Ir para o atendimento"
            className="grid size-8 place-items-center rounded-full text-suave transition-colors hover:bg-superficie-alta hover:text-texto">
        <Headphones size={15} />
      </Link>
      <form action={sair}>
        <input type="hidden" name="entrada" value={entrada} />
        <button title="Sair"
                className="grid size-8 place-items-center rounded-full text-suave transition-colors hover:bg-superficie-alta hover:text-texto">
          <LogOut size={15} />
        </button>
      </form>
    </div>
  );

  // `flex-col` abaixo de `lg` não é detalhe de estilo: a barra estreita que o
  // MenuLateral renderiza é IRMÃ do <main>. Numa linha, ela virava uma coluna ao
  // lado do conteúdo e comia a largura — foi o que quebrou o painel lateral do
  // Chrome, que abre com menos de 400px. Empilhada, ela volta a ser cabeçalho.
  return (
    <div className="flex min-h-full flex-col lg:flex-row">
      <MenuLateral
        grupos={grupos}
        titulo={
          <p className="font-display text-lg font-semibold tracking-tight">Gestão</p>
        }
        rodape={rodape}
      />
      <main className="surgir mx-auto w-full max-w-6xl min-w-0 flex-1 px-4 py-6 sm:px-6 lg:py-8">
        {children}
      </main>
    </div>
  );
}
