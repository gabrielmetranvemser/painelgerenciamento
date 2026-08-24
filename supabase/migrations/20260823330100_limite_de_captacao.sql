-- =============================================================================
-- Limite de cadastros por IP no formulário público
-- =============================================================================
-- O formulário do candidato é a única porta do sistema aberta para a internet
-- inteira, e não tinha proteção nenhuma: nem limite, nem armadilha, nem nada.
--
-- O que um script fazia com isso, de graça:
--   • enchia a fila QUENTE de números inventados — e quente é atendido ANTES da
--     lista fria, então os atendentes queimariam o teto do dia em ninguém;
--   • fazia os chips falar com quem nunca pediu nada, que é exatamente o padrão
--     que o WhatsApp derruba;
--   • despachava santinho, adesivo e camiseta para endereços de brincadeira.
--
-- A escolha aqui foi limite por IP em vez de CAPTCHA: o eleitor não vê nada, não
-- perde nenhuma conversão e não depende de serviço de terceiro. Não segura um
-- atacante com muitos IPs — para isso existe o alerta, que põe a enchente na
-- tela do gestor em vez de deixá-la passar em silêncio.

create table if not exists public.tentativas_captacao (
  ip       inet not null,
  -- Início do bloco de tempo. Contar por bloco, e não por linha de tentativa,
  -- mantém a tabela pequena: um IP gera no máximo uma linha por janela.
  janela   timestamptz not null,
  contagem int not null default 1,
  primary key (ip, janela)
);

-- Sem policy nenhuma, de propósito: só o servidor (service_role) escreve aqui.
-- É tabela de defesa; quem pode lê-la pode mapear de onde vêm os cadastros.
alter table public.tentativas_captacao enable row level security;

/**
 * Conta mais uma tentativa e diz se ela ainda cabe no limite.
 *
 * Devolve `primeira_recusa` para o alerta ao gestor sair UMA vez por janela —
 * um aviso por cadastro recusado viraria mil linhas e ninguém leria nenhuma.
 *
 * IP nulo (proxy sem cabeçalho) passa: as outras camadas — a armadilha do campo
 * escondido e a trava de reenvio do mesmo número — continuam valendo, e recusar
 * todo mundo que o proxy não identificou seria derrubar cadastro legítimo.
 */
create or replace function public.registrar_tentativa_captacao(
  p_ip         inet,
  p_limite     int default 8,
  p_janela_min int default 10
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_janela   timestamptz;
  v_contagem int;
begin
  if p_ip is null then
    return jsonb_build_object('ok', true, 'contagem', 0, 'primeira_recusa', false);
  end if;

  -- Blocos fixos de p_janela_min minutos dentro da hora.
  v_janela := date_trunc('hour', now())
              + make_interval(mins => (extract(minute from now())::int / p_janela_min) * p_janela_min);

  insert into public.tentativas_captacao as t (ip, janela, contagem)
  values (p_ip, v_janela, 1)
  on conflict (ip, janela) do update set contagem = t.contagem + 1
  returning t.contagem into v_contagem;

  return jsonb_build_object(
    'ok',              v_contagem <= p_limite,
    'contagem',        v_contagem,
    'primeira_recusa', v_contagem = p_limite + 1
  );
end;
$$;

revoke execute on function public.registrar_tentativa_captacao(inet, int, int)
  from anon, public, authenticated;
grant  execute on function public.registrar_tentativa_captacao(inet, int, int)
  to service_role;

-- A tabela é descartável: o que passou de um dia não decide mais nada.
select cron.schedule(
  'limpar-tentativas-captacao',
  '30 7 * * *',
  $$delete from public.tentativas_captacao where janela < now() - interval '1 day'$$
);
