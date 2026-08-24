-- =============================================================================
-- Fuso horário inválido não entra mais na configuração
-- =============================================================================
-- ⚠️ Um erro de digitação aqui derrubava o sistema inteiro, para os 15
--    atendentes, ao mesmo tempo.
--
-- `config.timezone` aceitava qualquer texto. Toda conta de hora do projeto passa
-- por ele — `hoje_operacional()` e `hora_local()` fazem `now() at time zone
-- config.timezone`, e um valor que o Postgres não reconhece não devolve nulo:
-- **lança**. Como essas duas funções são a base de `fila_status`,
-- `pegar_proximo_contato`, `registrar_abertura` e das três automações do cron, o
-- efeito de trocar "America/Porto_Velho" por "America/PortoVelho" era a
-- operação inteira parar de responder — e a mensagem que sobraria na tela seria
-- um erro de banco cru.
--
-- A validação fica no BANCO, e não só na tela, porque é onde o dano acontece:
-- qualquer caminho que escreva em `config` passa por aqui.

create or replace function public.validar_config()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- `pg_timezone_names` é a lista canônica que o próprio Postgres usa para
  -- resolver `at time zone`. Conferir contra ela é conferir contra a mesma
  -- fonte que vai ser consultada na hora H.
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.timezone) then
    raise exception
      'Fuso horário "%" não existe. Use um nome de fuso do banco de dados, como America/Porto_Velho.',
      new.timezone
      using errcode = 'check_violation';
  end if;
  return new;
end;
$$;

drop trigger if exists config_validada on public.config;
create trigger config_validada
  before insert or update on public.config
  for each row execute function public.validar_config();

-- Confere que a linha que já existe passa (e falha alto se não passar).
update public.config set timezone = timezone where id = 1;
