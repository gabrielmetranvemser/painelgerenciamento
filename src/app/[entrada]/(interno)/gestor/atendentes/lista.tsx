'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { AlertTriangle, Check, Copy, KeyRound, Pencil, Power, UserPlus } from 'lucide-react';
import { Avatar, Aviso, Botao, Campo, Cartao, Pilula, Selecao } from '@/components/ui';
import type { Candidato, Usuario } from '@/lib/tipos-banco';
import { ChapaDoAtendente, type ItemChapa } from './chapa-do-atendente';
import { ListasDoAtendente, type ItemLista } from './listas-do-atendente';
import {
  alternarAtivo, criarAtendente, redefinirSenha, renomearAtendente, repararConsentimento,
  trocarEmail,
  type OrfaoDeChapa,
} from './acoes';

/**
 * O nome, e o lápis que troca.
 *
 * ⚠️ Não é rótulo de tela: é o nome que a pessoa do outro lado lê na mensagem
 * ("Aqui é o Lucas"). Por isso o aviso embaixo do campo — trocar aqui muda o
 * que sai daqui para a frente, e não o que já foi enviado.
 */
function Nome({ usuario }: { usuario: Usuario }) {
  const [editando, setEditando] = useState(false);
  const [nome, setNome] = useState(usuario.primeiro_nome);
  const [erro, setErro] = useState<string | null>(null);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  if (!editando) {
    return (
      <p className="flex items-center gap-2 text-sm font-semibold">
        <span className="truncate">{usuario.primeiro_nome}</span>
        {usuario.papel === 'gestor' && <Pilula cor="acento">gestor</Pilula>}
        <button type="button" title="Trocar o nome"
                onClick={() => { setNome(usuario.primeiro_nome); setEditando(true); }}
                className="shrink-0 text-suave transition-colors hover:text-texto">
          <Pencil size={12} />
        </button>
      </p>
    );
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await renomearAtendente(usuario.id, nome);
          if (r.ok) { setErro(null); setEditando(false); router.refresh(); } else setErro(r.erro);
        });
      }}
    >
      <div className="flex items-center gap-2">
        <input
          autoFocus
          value={nome}
          onChange={(e) => setNome(e.target.value)}
          onKeyDown={(e) => {
            // Esc desfaz: quem abriu por engano não fica preso entre salvar um
            // nome errado e recarregar a página.
            if (e.key !== 'Escape') return;
            setNome(usuario.primeiro_nome);
            setErro(null);
            setEditando(false);
          }}
          aria-label="Primeiro nome"
          className="w-40 rounded-xl border border-borda-forte bg-superficie-alta px-3 py-1.5 text-sm font-semibold text-texto"
        />
        <Botao type="submit" tamanho="p" disabled={ocupado}><Check size={13} /> Salvar</Botao>
      </div>
      {erro
        ? <p className="text-xs text-perigo">{erro}</p>
        : <p className="text-xs leading-relaxed text-suave">
            É o nome que aparece na mensagem que a pessoa recebe. Vale das próximas mensagens em
            diante; as já enviadas ficam como foram.
          </p>}
    </form>
  );
}

/**
 * O e-mail de acesso, e o lápis que troca.
 *
 * ⚠️ Não é rótulo: é por onde a pessoa ENTRA. Trocar aqui derruba o login
 * antigo, então a tela diz isso antes de salvar — e o botão de copiar existe
 * porque o gestor precisa mandar esse endereço para alguém no WhatsApp, e
 * selecionar texto de 12px no meio de um cartão é onde o erro de digitação
 * nasce.
 */
function Email({ id, email }: { id: string; email: string | undefined }) {
  const [editando, setEditando] = useState(false);
  const [valor, setValor] = useState(email ?? '');
  const [erro, setErro] = useState<string | null>(null);
  const [copiado, setCopiado] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  if (!editando) {
    return (
      <p className="flex items-center gap-1.5 truncate text-xs text-suave">
        <span className="truncate">
          {email ?? <span className="text-tenue">(sem e-mail de acesso)</span>}
        </span>
        {email && (
          <button type="button" title="Copiar o e-mail"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(email);
                      setCopiado(true);
                      setTimeout(() => setCopiado(false), 1500);
                    } catch { /* sem área de transferência: o e-mail está à vista */ }
                  }}
                  className="shrink-0 transition-colors hover:text-texto">
            {copiado ? <Check size={11} className="text-ok" /> : <Copy size={11} />}
          </button>
        )}
        <button type="button" title="Trocar o e-mail de acesso"
                onClick={() => { setValor(email ?? ''); setEditando(true); }}
                className="shrink-0 transition-colors hover:text-texto">
          <Pencil size={11} />
        </button>
      </p>
    );
  }

  return (
    <form
      className="space-y-1.5"
      onSubmit={(e) => {
        e.preventDefault();
        iniciar(async () => {
          const r = await trocarEmail(id, valor);
          if (r.ok) { setErro(null); setEditando(false); router.refresh(); } else setErro(r.erro);
        });
      }}
    >
      <div className="flex items-center gap-2">
        <input
          autoFocus type="email" value={valor}
          onChange={(e) => setValor(e.target.value)}
          onKeyDown={(e) => {
            if (e.key !== 'Escape') return;
            setValor(email ?? ''); setErro(null); setEditando(false);
          }}
          aria-label="E-mail de acesso"
          className="w-64 rounded-xl border border-borda-forte bg-superficie-alta px-3 py-1.5 text-xs text-texto"
        />
        <Botao type="submit" tamanho="p" disabled={ocupado}><Check size={13} /> Salvar</Botao>
      </div>
      {erro
        ? <p className="text-xs text-perigo">{erro}</p>
        : <p className="text-xs leading-relaxed text-suave">
            É por onde a pessoa entra. O e-mail antigo para de funcionar no próximo login —
            avise antes de salvar.
          </p>}
    </form>
  );
}

/**
 * O aviso de consentimento congelado sem chapa, e o botão que o repara.
 *
 * ⚠️ O QUE ESTE BOTÃO FAZ É SÉRIO. `registrar_abertura` congela, na primeira
 * mensagem, quais candidatos foram declarados àquela pessoa — é isso que a
 * resposta dela cobre, e é o que impede um candidato atribuído hoje de alcançar
 * quem autorizou ontem. Quando a chapa estava vazia, a cópia nasceu vazia, e o
 * material dessas pessoas ficou travado para sempre.
 *
 * Clicar aqui declara a chapa ATUAL para elas. Não é o congelamento normal: é o
 * gestor assumindo que aquelas pessoas vão receber material de alguém cujo nome
 * não estava na mensagem que elas responderam. Por isso o texto diz o que vai
 * acontecer antes, o sistema grava alerta, e cada linha reparada faz a tela do
 * atendente exigir que ele se apresente antes de mandar qualquer coisa.
 */
function ReparoDeChapa({ orfao }: { orfao: OrfaoDeChapa }) {
  const [erro, setErro] = useState<string | null>(null);
  const [feito, setFeito] = useState<number | null>(null);
  const [confirmando, setConfirmando] = useState(false);
  const [ocupado, iniciar] = useTransition();
  const router = useRouter();

  if (feito !== null) {
    return (
      <div className="border-t border-borda bg-fundo/40 px-5 py-4">
        <p className="text-xs leading-relaxed text-ok">
          {feito} contato(s) liberados. Avise {orfao.primeiro_nome}: essas pessoas não ouviram o
          nome do candidato na primeira mensagem, e a tela dela agora pede que se apresente antes
          de mandar o material.
        </p>
      </div>
    );
  }

  return (
    <div className="border-t border-borda bg-alerta/[0.06] px-5 py-4">
      <p className="flex gap-2 text-xs leading-relaxed text-alerta">
        <AlertTriangle size={14} className="mt-0.5 shrink-0" />
        <span>
          <strong>{orfao.contatos} contato(s) sem candidato declarado.</strong>{' '}
          {orfao.primeiro_nome} abordou essas pessoas antes de ter chapa, então a primeira
          mensagem saiu sem dizer de quem era o material — e o envio do material ficou travado
          para elas, mesmo agora que a chapa existe.
        </span>
      </p>

      {!orfao.tem_chapa ? (
        <p className="mt-3 text-xs leading-relaxed text-suave">
          Monte a chapa dela primeiro, aqui embaixo. Sem candidato não há o que declarar.
        </p>
      ) : confirmando ? (
        <div className="mt-3 space-y-2.5">
          <p className="text-xs leading-relaxed text-suave">
            Liberar declara a chapa atual de {orfao.primeiro_nome} para esses contatos. Elas vão
            poder receber material de um candidato que <strong className="text-texto">não foi
            citado</strong> na mensagem que responderam — a decisão é sua, fica registrada, e o
            atendente será obrigado a se apresentar antes de mandar qualquer peça.
          </p>
          <div className="flex flex-wrap gap-2">
            <Botao tamanho="p" disabled={ocupado}
              onClick={() => iniciar(async () => {
                const r = await repararConsentimento(orfao.atendente_id);
                if (r.ok) { setFeito(r.contatos); router.refresh(); } else setErro(r.erro);
              })}>
              {ocupado ? 'Liberando…' : `Sim, liberar os ${orfao.contatos}`}
            </Botao>
            <Botao tamanho="p" variante="neutro" disabled={ocupado}
                   onClick={() => setConfirmando(false)}>
              Cancelar
            </Botao>
          </div>
        </div>
      ) : (
        <Botao tamanho="p" variante="neutro" className="mt-3"
               onClick={() => { setErro(null); setConfirmando(true); }}>
          Liberar o material desses contatos
        </Botao>
      )}

      {erro && <p className="mt-2 text-xs text-perigo">{erro}</p>}
    </div>
  );
}

function BotaoCriar() {
  const { pending } = useFormStatus();
  return <Botao type="submit" disabled={pending}>{pending ? 'Criando…' : 'Criar conta'}</Botao>;
}

/**
 * O acesso recém-criado ou redefinido, pronto para mandar.
 *
 * ⚠️ NÃO EXISTE "copiar a senha atual", e não vai passar a existir: o Supabase
 * guarda hash, e guardar a senha em claro para poder copiá-la trocaria uma
 * inconveniência por um vazamento — além de desmentir a frase que esta própria
 * tela diz à pessoa. A senha só é visível no instante em que é gerada.
 *
 * O que faltava de verdade era ISTO servir aos dois casos. O botão de copiar
 * existia só na criação da conta; quem clicava em "Nova senha" via a senha na
 * tela e tinha de selecionar caractere por caractere para mandar no WhatsApp.
 */
function Acesso({
  email, senha, entrada, novaSenha,
}: {
  email: string;
  senha: string;
  entrada: string;
  /** `true` quando é redefinição, não conta nova. Muda só o texto. */
  novaSenha?: boolean;
}) {
  const [copiado, setCopiado] = useState(false);
  const [falhou, setFalhou] = useState(false);

  // Sai pronto para colar no WhatsApp do atendente: acesso e o passo a passo de
  // preparar a máquina, junto. Mandar só a senha garante a pergunta seguinte.
  const recado = [
    novaSenha ? 'Sua senha nova do painel:' : 'Seu acesso ao painel:',
    '',
    `E-mail: ${email}`,
    `Senha: ${senha}`,
    '',
    'Antes de começar, siga os 5 passos para preparar seu computador:',
    typeof window === 'undefined' ? '' : `${window.location.origin}/${entrada}/instalar`,
  ].join('\n');

  return (
    <Aviso tom="ok">
      <p className="font-semibold">
        {novaSenha ? 'Senha redefinida. Anote agora.' : 'Conta criada. Anote a senha agora.'}
      </p>
      <p className="mt-3 font-mono text-sm">{email}</p>
      <p className="font-mono text-lg font-semibold">{senha}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        <button
          type="button"
          className="rounded-full border border-ok/30 px-3 py-1.5 text-xs font-semibold"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(recado);
              setCopiado(true); setFalhou(false);
            } catch { setFalhou(true); }
          }}
        >
          {copiado ? 'copiado ✓' : 'copiar recado pronto para o WhatsApp'}
        </button>
        <button
          type="button"
          className="rounded-full border border-ok/30 px-3 py-1.5 text-xs font-semibold"
          onClick={async () => {
            try {
              await navigator.clipboard.writeText(senha);
              setCopiado(true); setFalhou(false);
            } catch { setFalhou(true); }
          }}
        >
          copiar só a senha
        </button>
      </div>

      {falhou && (
        <p className="mt-2 text-xs">
          O navegador não deixou copiar. Selecione a senha acima e copie na mão.
        </p>
      )}

      <p className="mt-3 text-xs leading-relaxed">
        O recado já inclui o link do passo a passo de instalação. <strong>Não guardamos senha em
        lugar nenhum</strong> — nem nós conseguimos ver a senha atual de alguém. Se esta se
        perder, o único caminho é gerar outra.
      </p>
    </Aviso>
  );
}

export function GerenciarAtendentes({
  usuarios, entrada, candidatos, chapas, listas, listasPorAtendente, emails, orfaos,
}: {
  usuarios: Usuario[];
  entrada: string;
  candidatos: Candidato[];
  chapas: Record<string, ItemChapa[]>;
  listas: ItemLista[];
  listasPorAtendente: Record<string, string[]>;
  /** id da conta → e-mail de acesso. Vem de `auth.users`, não de `usuarios`. */
  emails: Record<string, string>;
  /** Contatos abordados antes de o atendente ter chapa. Ver `ReparoDeChapa`. */
  orfaos: Record<string, OrfaoDeChapa>;
}) {
  const [estado, acao] = useActionState(criarAtendente, null);
  const [ocupado, iniciar] = useTransition();
  const [novaSenha, setNovaSenha] = useState<{ email: string; senha: string } | null>(null);

  return (
    <div className="grid gap-5 lg:grid-cols-[380px_1fr]">
      <div className="space-y-4">
        <Cartao className="p-6">
          <h2 className="mb-1 flex items-center gap-2 font-semibold"><UserPlus size={16} className="text-suave" /> Nova conta</h2>
          <p className="mb-4 text-xs text-suave">
            Ninguém se cadastra sozinho. Você cria a conta e entrega a senha.
          </p>
          <form action={acao} className="space-y-4">
            <Campo rotulo="Primeiro nome" name="primeiro_nome" required placeholder="Lucas"
                   dica="É o nome que aparece na mensagem que a pessoa recebe." />
            <Campo rotulo="E-mail" name="email" type="email" required placeholder="lucas@exemplo.com" />
            <Selecao rotulo="Papel" name="papel" defaultValue="atendente">
              <option value="atendente">Atendente</option>
              <option value="gestor">Gestor</option>
            </Selecao>
            <BotaoCriar />
          </form>
        </Cartao>

        {estado?.ok && <Acesso email={estado.email} senha={estado.senha} entrada={entrada} />}
        {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}
        {novaSenha && (
          <Acesso
            key={novaSenha.senha}
            email={novaSenha.email} senha={novaSenha.senha} entrada={entrada} novaSenha
          />
        )}
      </div>

      <div className="space-y-4">
        {usuarios.length === 0 && (
          <Cartao className="p-8 text-center text-sm text-suave">Ninguém cadastrado ainda.</Cartao>
        )}
        {usuarios.map((u) => (
          <Cartao key={u.id} className="overflow-hidden">
          <div className="flex flex-wrap items-center gap-3 px-5 py-4">
            <Avatar nome={u.primeiro_nome} fotoUrl={u.foto_url} tamanho="m" />
            <div className="mr-auto min-w-0">
              <Nome usuario={u} />
              {/* O e-mail é por onde a pessoa entra. Sem ele na tela, quem
                  esquecia qual conta era de quem redefinia a senha errada. */}
              <Email id={u.id} email={emails[u.id]} />
              <p className="text-xs text-suave">
                {u.termo_aceito_em
                  ? `termo aceito em ${new Date(u.termo_aceito_em).toLocaleDateString('pt-BR')}`
                  : 'ainda não aceitou o termo'}
              </p>
            </div>

            <Botao variante="fantasma" tamanho="p" disabled={ocupado}
              onClick={() => iniciar(async () => {
                const r = await redefinirSenha(u.id);
                // O e-mail vai junto: o recado que o gestor manda precisa dos
                // dois, e ter só a senha faz a pessoa perguntar qual conta é.
                if (r.ok && r.senha) setNovaSenha({ email: emails[u.id] ?? '', senha: r.senha });
              })}>
              <KeyRound size={12} /> Nova senha
            </Botao>

            <Botao variante={u.ativo ? 'neutro' : 'principal'} tamanho="p" disabled={ocupado}
              onClick={() => iniciar(async () => { await alternarAtivo(u.id, !u.ativo); })}>
              <Power size={12} /> {u.ativo ? 'Desativar' : 'Reativar'}
            </Botao>
          </div>

          {u.papel === 'atendente' && orfaos[u.id] && (
            <ReparoDeChapa orfao={orfaos[u.id]} />
          )}

          {u.papel === 'atendente' && (
            <>
              <ChapaDoAtendente
                atendenteId={u.id}
                chapa={chapas[u.id] ?? []}
                candidatos={candidatos}
              />
              <ListasDoAtendente
                atendenteId={u.id}
                listas={listas}
                marcadas={listasPorAtendente[u.id] ?? []}
              />
            </>
          )}
          </Cartao>
        ))}
      </div>
    </div>
  );
}
