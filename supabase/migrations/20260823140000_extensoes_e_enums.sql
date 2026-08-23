-- =============================================================================
-- Extensões e tipos
-- =============================================================================
-- Ver docs/02-CONSTRUCAO-TECNICA.md §3. O schema aqui difere do documento em
-- pontos marcados com "CORREÇÃO" — cada um evita um bug de produção concreto.

create extension if not exists pgcrypto with schema extensions;

-- Origem do contato. Decide a ordem da fila: 'site' e 'kit' são QUENTES
-- (a pessoa pediu contato) e vêm sempre antes de 'lista_fria'.
create type public.origem_contato as enum ('site', 'kit', 'lista_fria');

create type public.status_contato as enum (
  'novo',            -- captação registrada, ainda não promovida à fila
  'na_fila',
  'em_atendimento',
  'autorizou',
  'pediu_saida',
  'invalido',        -- o atendente constatou que o número não é da pessoa
  'quer_ajudar',
  'encaminhado',
  'sem_resposta',    -- 72h sem retorno
  'perdido'          -- o chip que atendia morreu; a conversa foi junto
);

create type public.etapa_msg as enum (
  'permissao',
  'material',
  'saida',
  'quem_passou',
  'quer_ajudar',
  'encaminhamento',
  'convite_grupo'
);

create type public.status_chip as enum (
  'aquecendo',  -- ainda em rampa
  'ativo',
  'amarelo',    -- sinal de alerta; reduzir ritmo
  'pausado',
  'morto'
);

create type public.papel_usuario as enum ('gestor', 'atendente');

-- 'ativo' faz o atendimento; 'reserva' fica pareado e aquecido, sem tocar na
-- lista, pronto para substituir (docs/03-OPERACAO.md §2.4).
create type public.papel_chip as enum ('ativo', 'reserva');

-- Por que a fila pode se recusar a entregar o próximo contato. O frontend usa
-- para mostrar a mensagem certa e a contagem regressiva.
create type public.motivo_fila as enum (
  'ok',
  'termo_nao_aceito',
  'usuario_inativo',
  'chip_nao_e_seu',
  'chip_indisponivel',
  'dia_bloqueado',
  'fora_de_horario',
  'teto_atingido',
  'intervalo',
  'fila_vazia'
);
