-- =============================================================================
-- Quem pediu saída não volta por um formulário que qualquer um preenche
-- =============================================================================
-- ⚠️ Este era o furo mais caro do sistema.
--
-- `registrarCaptacao` APAGAVA a linha de `bloqueios` quando o telefone chegava
-- pelo formulário público, com a justificativa de que um cadastro novo é
-- consentimento mais forte que o pedido de saída antigo. O raciocínio só se
-- sustenta se quem preencheu for a dona do número — e o formulário não prova
-- isso em lugar nenhum: não há código por SMS, não há confirmação, não há nada.
--
-- Na prática, qualquer pessoa (ou um script com a lista de opt-outs na mão)
-- devolvia à fila QUENTE justamente quem tinha pedido para sair. Envio depois
-- do pedido de saída é multa POR MENSAGEM, e a página /privacidade promete, com
-- todas as letras, "não voltamos a falar com você, mesmo que seu número apareça
-- em outra lista".
--
-- A partir daqui o bloqueio só se desfaz pela mão do gestor, com registro.
-- Esta migration prepara o terreno; a decisão em si está em src/lib/captacao.ts.

-- ── 1. A captação passa a guardar o HMAC ──────────────────────────────────
-- É o único identificador que sobrevive à purga de 48h, e é o que liga uma
-- captação à lista de bloqueio sem a chave secreta precisar entrar no Postgres.
--
-- Não é dado novo exposto: esta tabela já guarda o telefone em claro. O HMAC é
-- justamente o que PERMITE apagar o telefone e ainda saber quem é (item 3).
alter table public.captacoes
  add column if not exists telefone_hmac text;

create index if not exists captacoes_hmac_idx
  on public.captacoes (telefone_hmac)
  where telefone_hmac is not null;

-- Preenche o que já existe, a partir do contato correspondente.
update public.captacoes cap
   set telefone_hmac = c.telefone_hmac
  from public.contatos c
 where cap.contato_id = c.id
   and cap.telefone_hmac is null;

-- ── 2. O alerta aponta para a captação ────────────────────────────────────
-- Sem isto, "número bloqueado tentou se recadastrar" seria um texto solto: o
-- gestor leria o aviso e não teria como agir sobre ele.
alter table public.alertas
  add column if not exists captacao_id uuid references public.captacoes(id) on delete cascade;

-- ── 3. A purga de 48h passa a alcançar `captacoes` ────────────────────────
-- ⚠️ Defeito encontrado junto: a purga só limpava `contatos`.
--
-- Quem pediu o kit deixou nome, telefone, CEP, rua, número e bairro em
-- `captacoes` — o endereço da casa. Ao pedir saída, o contato era anonimizado e
-- essa linha ficava intacta, para sempre. A promessa de apagar em 48h valia
-- pela metade, e valia menos justamente para quem entregou mais dado.
--
-- O HMAC fica, como em `contatos`: é ele que impede o número de voltar.
create or replace function public.purgar_dados_de_saida()
returns int
language plpgsql security definer set search_path = ''
as $$
declare
  v_contatos  int;
  v_captacoes int;
begin
  with purgados as (
    update public.contatos c
       set nome = null,
           primeiro_nome = null,
           telefone_e164 = null,
           chave_dedup = null,
           encaminhamento = null,
           anonimizado_em = now()
      from public.bloqueios b
     where b.telefone_hmac = c.telefone_hmac
       and b.apagar_em < now()
       and c.anonimizado_em is null
     returning 1
  ) select count(*)::int into v_contatos from purgados;

  with limpas as (
    update public.captacoes cap
       set nome = null,
           telefone_e164 = null,
           chave_dedup = null,
           endereco = null,
           cep = null,
           rua = null,
           numero = null,
           bairro = null
      from public.bloqueios b
     where b.telefone_hmac = cap.telefone_hmac
       and b.apagar_em < now()
       and (cap.telefone_e164 is not null or cap.endereco is not null)
     returning 1
  ) select count(*)::int into v_captacoes from limpas;

  return v_contatos + v_captacoes;
end;
$$;

revoke execute on function public.purgar_dados_de_saida() from anon, public, authenticated;
