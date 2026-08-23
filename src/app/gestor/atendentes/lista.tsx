'use client';

import { useActionState, useState, useTransition } from 'react';
import { useFormStatus } from 'react-dom';
import { KeyRound, Power, UserPlus } from 'lucide-react';
import { Avatar, Aviso, Botao, Campo, Cartao, Pilula, Selecao } from '@/components/ui';
import type { Usuario } from '@/lib/tipos-banco';
import { alternarAtivo, criarAtendente, redefinirSenha } from './acoes';

function BotaoCriar() {
  const { pending } = useFormStatus();
  return <Botao type="submit" disabled={pending}>{pending ? 'Criando…' : 'Criar conta'}</Botao>;
}

function Senha({ email, senha }: { email: string; senha: string }) {
  const [copiado, setCopiado] = useState(false);
  return (
    <Aviso tom="ok">
      <p className="font-medium">Conta criada. Anote a senha agora.</p>
      <p className="mt-2 font-mono text-sm">{email}</p>
      <p className="font-mono text-lg font-semibold">{senha}</p>
      <button
        type="button"
        className="mt-2 text-xs underline"
        onClick={async () => {
          await navigator.clipboard.writeText(`${email}\n${senha}`);
          setCopiado(true);
        }}
      >
        {copiado ? 'copiado ✓' : 'copiar e-mail e senha'}
      </button>
      <p className="mt-2 text-xs">
        Não guardamos senha em lugar nenhum. Se perder, gere outra pelo botão da lista.
      </p>
    </Aviso>
  );
}

export function GerenciarAtendentes({ usuarios }: { usuarios: Usuario[] }) {
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

        {estado?.ok && <Senha email={estado.email} senha={estado.senha} />}
        {estado && !estado.ok && <Aviso tom="erro">{estado.erro}</Aviso>}
        {novaSenha && (
          <Aviso tom="ok">
            <p className="font-medium">Senha nova de {novaSenha.nome}</p>
            <p className="mt-1 font-mono text-lg font-semibold">{novaSenha.senha}</p>
          </Aviso>
        )}
      </div>

      <Cartao className="divide-y divide-borda overflow-hidden">
        {usuarios.length === 0 && <p className="p-8 text-center text-sm text-suave">Ninguém cadastrado ainda.</p>}
        {usuarios.map((u) => (
          <div key={u.id} className="flex flex-wrap items-center gap-3 px-5 py-4">
            <Avatar nome={u.primeiro_nome} fotoUrl={u.foto_url} tamanho="m" />
            <div className="mr-auto min-w-0">
              <p className="flex items-center gap-2 text-sm font-semibold">
                {u.primeiro_nome}
                {u.papel === 'gestor' && <Pilula cor="acento">gestor</Pilula>}
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
        ))}
      </Cartao>
    </div>
  );
}
