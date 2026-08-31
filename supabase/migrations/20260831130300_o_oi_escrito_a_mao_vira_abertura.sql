-- =============================================================================
-- O "oi" que o gestor escreveu dentro da Permissão vira Abertura de verdade
-- =============================================================================
-- ⚠️ ISTO MEXE EM TEXTO DO GESTOR, e por isso a explicação é longa.
--
-- Ao olhar a base em 31/08, as duas variações ATIVAS da Permissão eram:
--
--     "{{saudacao}}! Tudo bem por aí?"
--     "Oi! {{saudacao}}! Tudo bem?"
--
-- Ou seja: ele já tinha reescrito a Permissão para ser uma ABERTURA. Estava
-- montando à mão os quatro passos que o painel não tinha — e é exatamente o que
-- ele pediu que fosse construído.
--
-- O problema é que, com a Abertura existindo de verdade, deixar isso como está
-- quebra a conversa de duas formas:
--
--   1. a pessoa recebe "oi" duas vezes — uma da Abertura, outra da Permissão;
--   2. a Permissão é a etapa que CONGELA O CONSENTIMENTO: é no envio dela que
--      `contato_candidato` grava quais candidatos foram declarados àquela
--      pessoa, e é isso que autoriza todo material que vem depois. Um "Oi!
--      Tudo bem?" não declara nada e não pede nada. O consentimento ficaria
--      registrado sobre uma mensagem que não pergunta.
--
-- O que esta migration faz, e nada além disso:
--
--   • COPIA os dois textos dele para a Abertura, onde eles são bons — são
--     aberturas melhores que as três genéricas que a migration anterior criou,
--     porque são as palavras dele;
--   • DESATIVA as três aberturas genéricas, para não sobrar texto de máquina
--     ao lado do texto dele;
--   • DESATIVA as duas variações de "oi" dentro da Permissão;
--   • ATIVA a variação de Permissão que pede de verdade.
--
-- Nada é apagado. Reativar qualquer uma é um clique em Gestor → Mensagens.
--
-- Tudo é condicionado ao estado exato descrito acima: se o gestor já tiver
-- arrumado sozinho, esta migration não faz nada.

-- ── 1. Os textos dele viram Abertura ────────────────────────────────────────
insert into public.variacoes (modelo_id, texto, ordem, ativa)
select (select id from public.modelos where etapa = 'abertura'),
       v.texto,
       10 + v.ordem,
       true
  from public.variacoes v
  join public.modelos m on m.id = v.modelo_id
 where m.etapa = 'permissao'
   and v.ativa
   -- Só o que É uma abertura: curto, sem pedido, sem declaração de chapa.
   and v.texto not like '%{{candidatos}}%'
   and v.texto not like '%{{origem}}%'
   and length(v.texto) < 80
   and not exists (
     select 1 from public.variacoes a
      join public.modelos ma on ma.id = a.modelo_id
     where ma.etapa = 'abertura' and a.texto = v.texto
   );

-- ── 2. As aberturas genéricas saem de cena, se as dele entraram ─────────────
update public.variacoes v
   set ativa = false
  from public.modelos m
 where m.id = v.modelo_id
   and m.etapa = 'abertura'
   and v.ordem <= 3
   and exists (
     select 1 from public.variacoes a
     where a.modelo_id = v.modelo_id and a.ordem > 10 and a.ativa
   );

-- ── 3. O "oi" sai da Permissão ──────────────────────────────────────────────
update public.variacoes v
   set ativa = false
  from public.modelos m
 where m.id = v.modelo_id
   and m.etapa = 'permissao'
   and v.ativa
   and v.texto not like '%{{candidatos}}%'
   and v.texto not like '%{{origem}}%'
   and length(v.texto) < 80;

-- ── 4. E a Permissão volta a pedir ──────────────────────────────────────────
-- ⚠️ ATIVA UMA, e só uma, escolhida pelo texto exato que a migration anterior
-- criou para isto.
--
-- A primeira versão disto dizia "ative as que declaram a chapa, se não sobrou
-- nenhuma ativa" — e ativou QUATRO de uma vez, ressuscitando três variações que
-- o gestor tinha desligado de propósito. O `not exists` é avaliado contra o
-- retrato de antes da instrução, então ele valeu para todas as linhas ao mesmo
-- tempo. Escolher pelo texto evita o problema inteiro, e mexe no mínimo: as que
-- ele desligou continuam desligadas, a um clique de voltar.
update public.variacoes v
   set ativa = true
  from public.modelos m
 where m.id = v.modelo_id
   and m.etapa = 'permissao'
   and v.texto like 'Posso te mandar o material%'
   and not exists (
     select 1 from public.variacoes a
     where a.modelo_id = v.modelo_id and a.ativa
   );

-- ⚠️ Rede de segurança: nenhuma das nove etapas pode ficar sem texto ativo.
do $$
declare v_etapa text;
begin
  select string_agg(m.etapa::text, ', ') into v_etapa
    from public.modelos m
   where m.ativo
     and not exists (
       select 1 from public.variacoes v where v.modelo_id = m.id and v.ativa
     );
  if v_etapa is not null then
    raise exception 'Etapa(s) sem nenhuma variação ativa: %. O atendente travaria no turno.', v_etapa;
  end if;
end $$;
