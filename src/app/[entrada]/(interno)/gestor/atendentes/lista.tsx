'use client';

import { useRouter } from 'next/navigation';
import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { Check, KeyRound, Pencil, Power, UserPlus } from 'lucide-react';
import { Avatar, Aviso, Botao, Campo, Cartao, Pilula, Selecao } from '@/components/ui';
import type { Candidato, Usuario } from '@/lib/tipos-banco';
import { ChapaDoAtendente, type ItemChapa } from './chapa-do-atendente';
import { ListasDoAtendente, type ItemLista } from './listas-do-atendente';
import { alternarAtivo, criarAtendente, redefinirSenha, renomearAtendente } from './acoes';

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

function BotaoCriar() {
  const { pending } = useFormStatus();
  return <Botao type="submit" disabled={pending}>{pending ? 'Criando…' : 'Criar conta'}</Botao>;
}

function Senha({ email, senha, entrada }: { email: string; senha: string; entrada: string }) {
  const [copiado, setCopiado] = useState(false);

  // Sai pronto para colar no WhatsApp do atendente: acesso e o passo a passo de
  // preparar a máquina, junto. Mandar só a senha garante a pergunta seguinte.
  const recado = [
    'Seu acesso ao painel:',
    '',
    `E-mail: ${email}`,
    `Senha: ${senha}`,
    '',
    'Antes de começar, siga os 5 passos para preparar seu computador:',
    typeof window === 'undefined' ? '' : `${window.location.origin}/${entrada}/instalar`,
  ].join('\n');

  return (
    <Aviso tom="ok">
      <p className="font-semibold">Conta criada. Anote a senha agora.</p>
      <p className="mt-3 font-mono text-sm">{email}</p>
      <p className="font-mono text-lg font-semibold">{senha}</p>
      <button
        type="button"
        className="mt-3 rounded-full border border-ok/30 px-3 py-1.5 text-xs font-semibold"
        onClick={async () => {
          await navigator.clipboard.writeText(recado);
          setCopiado(true);
        }}
      >
        {copiado ? 'copiado ✓' : 'copiar recado pronto para o WhatsApp'}
      </button>
      <p className="mt-3 text-xs leading-relaxed">
        O recado já inclui o link do passo a passo de instalação. Não guardamos senha em lugar
        nenhum: se perder, gere outra pelo botão da lista.
      </p>
    </Aviso>
  );
}

export function GerenciarAtendentes({
  usuarios, entrada, candidatos, chapas, listas, listasPorAtendente, emails,
}: {
  usuarios: Usuario[];
  entrada: string;
  candidatos: Candidato[];
  chapas: Record<string, ItemChapa[]>;
  listas: ItemLista[];
  listasPorAtendente: Record<string, string[]>;
  /** id da conta → e-mail de acesso. Vem de `auth.users`, não de `usuarios`. */
  emails: Record<string, string>;
}) {
  const [estado, acao] = useActionState(criarAtendente, null);
  const [ocupado, iniciar] = useTransition();
  const [novaSenha, setNovaSenha] = useState<{ nome: string; senha: string } | null>(null);

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

        {estado?.ok && <Senha email={estado.email} senha={estado.senha} entrada={entrada} />}
        {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}
        {novaSenha && (
          <Aviso tom="ok">
            <p className="font-medium">Senha nova de {novaSenha.nome}</p>
            <p className="mt-1 font-mono text-lg font-semibold">{novaSenha.senha}</p>
          </Aviso>
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
              <p className="truncate text-xs text-suave">
                {/* O e-mail é por onde a pessoa entra. Sem ele na tela, quem
                    esquecia qual conta era de quem redefinia a senha errada. */}
                {emails[u.id] ?? <span className="text-tenue">(sem e-mail de acesso)</span>}
              </p>
              <p className="text-xs text-suave">
                {u.termo_aceito_em
                  ? `termo aceito em ${new Date(u.termo_aceito_em).toLocaleDateString('pt-BR')}`
                  : 'ainda não aceitou o termo'}
              </p>
            </div>

            <Botao variante="fantasma" tamanho="p" disabled={ocupado}
              onClick={() => iniciar(async () => {
                const r = await redefinirSenha(u.id);
                if (r.ok && r.senha) setNovaSenha({ nome: u.primeiro_nome, senha: r.senha });
              })}>
              <KeyRound size={12} /> Nova senha
            </Botao>

            <Botao variante={u.ativo ? 'neutro' : 'principal'} tamanho="p" disabled={ocupado}
              onClick={() => iniciar(async () => { await alternarAtivo(u.id, !u.ativo); })}>
              <Power size={12} /> {u.ativo ? 'Desativar' : 'Reativar'}
            </Botao>
          </div>

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
