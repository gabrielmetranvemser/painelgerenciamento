import type { Metadata } from 'next';
import Link from 'next/link';
import {
  ArrowRight, Blocks, Download, Puzzle, ShieldCheck, TriangleAlert, UserRoundPlus,
} from 'lucide-react';
import { criarClienteServidor } from '@/lib/supabase/server';
import { usuarioAtual } from '@/lib/sessao';
import { Aviso, BotaoLink, Cartao, Pilula } from '@/components/ui';
import type { Chip } from '@/lib/tipos-banco';

export const metadata: Metadata = { title: 'Preparar sua máquina' };
export const dynamic = 'force-dynamic';

export default async function PaginaInstalar({
  params,
}: {
  params: Promise<{ entrada: string }>;
}) {
  const { entrada } = await params;
  const usuario = await usuarioAtual();
  const supabase = await criarClienteServidor();

  const { data } = await supabase
    .from('chips')
    .select('*')
    .eq('atendente_id', usuario!.id)
    .neq('status', 'morto')
    .order('papel')
    .order('rotulo');

  const chips = (data ?? []) as Chip[];
  const ativo = chips.find((c) => c.papel === 'ativo') ?? chips[0];
  const reserva = chips.find((c) => c.papel === 'reserva');

  return (
    <main className="mx-auto w-full max-w-2xl flex-1 px-4 py-10 sm:px-6">
      <header className="mb-10">
        <Pilula cor="acento">Só precisa fazer uma vez</Pilula>
        <h1 className="mt-4 font-display text-4xl font-semibold tracking-tight">
          Preparar sua máquina
        </h1>
        <p className="mt-3 text-[15px] leading-relaxed text-suave">
          {usuario!.primeiro_nome}, são cinco passos. Depois disso você abre um atalho e já está
          pronto para atender, com o painel na lateral e o WhatsApp do lado.
        </p>
      </header>

      <ol className="space-y-4">
        <Passo n={1} titulo="Baixar a extensão" icone={<Download size={16} />}>
          <p>
            É ela que coloca o painel na lateral do navegador, encostado no WhatsApp Web. O
            arquivo já vem configurado — você não precisa editar nada.
          </p>
          <BotaoLink href={`/${entrada}/extensao`} prefetch={false} tamanho="g" className="mt-5">
            <Download size={17} /> Baixar a extensão
          </BotaoLink>
          <p className="mt-4 text-xs">
            Descompacte num lugar que você não vá mexer depois — por exemplo, uma pasta{' '}
            <span className="rounded bg-superficie-alta px-1.5 py-0.5 font-mono text-[11px]">painel</span>{' '}
            dentro de Documentos. O Chrome lê os arquivos dali toda vez que abre; se a pasta sumir,
            a extensão para de funcionar.
          </p>
        </Passo>

        <Passo n={2} titulo="Criar dois perfis no Chrome" icone={<UserRoundPlus size={16} />}>
          <p>
            O WhatsApp Web aceita <strong>uma conta por perfil de navegador</strong>. Com um perfil
            só, trocar de número exigiria escanear o QR de novo toda vez. Com dois, cada número
            fica logado para sempre e trocar vira mudar de janela.
          </p>
          <ol className="mt-4 space-y-2">
            <li>Clique na sua foto, no canto superior direito do Chrome</li>
            <li>Escolha <strong>Adicionar</strong> e crie um perfil</li>
            <li>Repita para criar o segundo</li>
          </ol>
          <p className="mt-4">
            Dê aos perfis o nome dos seus números
            {ativo && reserva
              ? <> — <strong>{ativo.rotulo}</strong> e <strong>{reserva.rotulo}</strong>.</>
              : <> — por exemplo, <strong>Chip A</strong> e <strong>Chip B</strong>.</>}
          </p>
        </Passo>

        <Passo n={3} titulo="Entrar no WhatsApp Web em cada perfil" icone={<Blocks size={16} />}>
          <p>
            Em <strong>cada</strong> perfil, abra <code className="rounded bg-superficie-alta px-1.5 py-0.5 font-mono text-[12px]">web.whatsapp.com</code>{' '}
            e escaneie o QR do número correspondente. Deixe logado — os perfis são isolados, então
            os dois ficam conectados ao mesmo tempo, sem conflito.
          </p>
          <Aviso tom="alerta" className="mt-5" icone={<ShieldCheck size={16} />}>
            <p className="font-semibold">Antes disso, no celular de cada número:</p>
            <ul className="mt-2 space-y-1.5">
              <li>Ative a <strong>verificação em duas etapas</strong> — sem isso o número pode ser sequestrado</li>
              <li>Coloque <strong>só o seu primeiro nome</strong> como nome de exibição, e uma <strong>foto sua</strong></li>
              <li>Nunca foto do candidato, de apoiador ou de material de campanha no perfil</li>
              <li>WhatsApp comum, <strong>não</strong> o Business</li>
              <li>Depois de definir nome e foto, <strong>não mude mais</strong> — trocar depois de aquecer parece conta invadida</li>
            </ul>
          </Aviso>
          <p className="mt-4 text-xs">
            Se o WhatsApp Web deslogar sozinho, é só escanear de novo. Ele desconecta quando o
            celular fica muito tempo sem entrar na internet — deixe o aparelho online de vez em quando.
          </p>
        </Passo>

        <Passo n={4} titulo="Instalar a extensão em cada perfil" icone={<Puzzle size={16} />}>
          <Aviso tom="alerta" className="mb-5" icone={<TriangleAlert size={16} />}>
            Extensão no Chrome é <strong>por perfil</strong>. Faça este passo inteiro nos{' '}
            <strong>dois</strong> perfis — instalar só num deles é o engano mais comum aqui.
          </Aviso>
          <ol className="space-y-2">
            <li>
              Abra{' '}
              <code className="rounded bg-superficie-alta px-1.5 py-0.5 font-mono text-[12px]">chrome://extensions</code>
            </li>
            <li>Ligue o <strong>Modo do desenvolvedor</strong>, no canto superior direito</li>
            <li>Clique em <strong>Carregar sem compactação</strong> e escolha a pasta que você descompactou</li>
            <li>Fixe o ícone na barra do Chrome</li>
          </ol>
          <p className="mt-4 text-xs">
            O Chrome vai avisar que há uma extensão em modo desenvolvedor toda vez que abrir. É
            normal e não tem como desligar — pode fechar o aviso e seguir.
          </p>
        </Passo>

        <Passo n={5} titulo="Primeiro contato" icone={<ArrowRight size={16} />} ultimo>
          <ol className="space-y-2">
            <li>Abra o Chrome no perfil do <strong>{ativo?.rotulo ?? 'seu número ativo'}</strong></li>
            <li>Deixe o WhatsApp Web aberto numa aba</li>
            <li>Clique no ícone da extensão — o painel abre na lateral</li>
            <li>Faça login e leia o termo de uso, que fica gravado com data e hora</li>
            <li>Clique em <strong>Buscar próximo contato</strong> e siga o que a tela pede</li>
          </ol>
          <p className="mt-4">
            O painel abre a conversa no WhatsApp já com o texto pronto. Você revisa, ajusta se
            quiser e envia. Depois volta ao painel e marca o resultado.
          </p>
          <BotaoLink href={`/${entrada}/painel`} tamanho="g" className="mt-5">
            Ir para o painel <ArrowRight size={17} />
          </BotaoLink>
        </Passo>
      </ol>

      <Cartao className="mt-8 p-6">
        <h2 className="font-semibold">Se o painel lateral abrir na tela de login e não entrar</h2>
        <p className="mt-2 text-sm leading-relaxed text-suave">
          É uma configuração de cookies daquela máquina. Use o link{' '}
          <strong>&ldquo;Abrir em uma aba&rdquo;</strong>, que aparece no rodapé do painel lateral —
          a aba comum funciona sempre, e você trabalha normalmente com as duas janelas lado a lado.
          Avise o gestor para ele ajustar depois.
        </p>
      </Cartao>

      <p className="mt-6 text-center text-xs text-suave">
        Travou em algum passo? Fale com o gestor antes de continuar.{' '}
        <Link href={`/${entrada}/painel`} className="underline underline-offset-4">Voltar ao painel</Link>
      </p>
    </main>
  );
}

function Passo({
  n, titulo, icone, children, ultimo,
}: {
  n: number; titulo: string; icone: React.ReactNode; children: React.ReactNode; ultimo?: boolean;
}) {
  return (
    <li className="relative pl-14">
      {/* Linha ligando os passos: deixa claro que é uma sequência, não uma lista
          de opções soltas. */}
      {!ultimo && <span aria-hidden className="absolute left-[1.375rem] top-12 h-[calc(100%-1rem)] w-px bg-borda" />}
      <span className="absolute left-0 top-1 grid size-11 place-items-center rounded-full border border-borda bg-superficie font-display text-lg font-semibold shadow-[var(--brilho),var(--sombra)]">
        {n}
      </span>
      <Cartao className="p-6">
        <h2 className="flex items-center gap-2 font-display text-xl font-semibold tracking-tight">
          <span className="text-suave">{icone}</span>
          {titulo}
        </h2>
        {/* Os sub-passos precisam MOSTRAR que são sequência. Sem marcador eles
            viram linhas soltas e a pessoa perde o fio no meio. */}
        <div className="mt-3 space-y-3 text-sm leading-relaxed text-suave
                        [&_code]:text-texto [&_strong]:text-texto
                        [&_ol]:list-decimal [&_ol]:space-y-1.5 [&_ol]:pl-5
                        [&_ul]:list-disc [&_ul]:space-y-1.5 [&_ul]:pl-5
                        [&_li]:pl-1 [&_li::marker]:text-tenue">
          {children}
        </div>
      </Cartao>
    </li>
  );
}
