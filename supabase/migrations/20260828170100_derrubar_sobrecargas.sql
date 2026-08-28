-- =============================================================================
-- Derruba as versões antigas de três funções
-- =============================================================================
-- ⚠️ ARMADILHA DO POSTGRES, e cara: `create or replace function` só REPLACE
-- quando a lista de argumentos é idêntica. Acrescentar um parâmetro — mesmo com
-- `default` — cria uma SOBRECARGA nova e deixa a antiga de pé.
--
-- O resultado é pior que um erro de sintaxe, porque o `db push` passa: as duas
-- versões convivem, e toda chamada que não passa o parâmetro novo vira
--
--   ERROR: function public.preparar_mensagem(uuid, uuid, unknown) is not unique
--
-- ou seja, o atendimento inteiro para na primeira mensagem do dia. Foi
-- exatamente o que a migration `modelos_livres` causou, e o que a suíte de
-- banco pegou.
--
-- Regra que cai daí: acrescentou parâmetro a uma função, derrube a assinatura
-- antiga na mesma leva.

drop function if exists public.preparar_mensagem(uuid, uuid, public.etapa_msg, uuid);

drop function if exists public.registrar_abertura(
  uuid, uuid, public.etapa_msg, text, uuid, uuid);

drop function if exists public.gravar_texto_preparado(
  uuid, public.etapa_msg, uuid, text);

-- As permissões vão junto com a função derrubada, então voltam aqui para as
-- assinaturas que ficaram.
revoke execute on function public.preparar_mensagem(uuid, uuid, public.etapa_msg, uuid, uuid)
  from anon, public;
grant  execute on function public.preparar_mensagem(uuid, uuid, public.etapa_msg, uuid, uuid)
  to authenticated;

revoke execute on function public.registrar_abertura(
  uuid, uuid, public.etapa_msg, text, uuid, uuid, uuid) from anon, public;
grant  execute on function public.registrar_abertura(
  uuid, uuid, public.etapa_msg, text, uuid, uuid, uuid) to authenticated;

revoke execute on function public.gravar_texto_preparado(
  uuid, public.etapa_msg, uuid, text, uuid) from anon, public;
grant  execute on function public.gravar_texto_preparado(
  uuid, public.etapa_msg, uuid, text, uuid) to authenticated;
