-- =============================================================================
-- O material passa a ir num link só: a página do candidato
-- =============================================================================
-- Antes a mensagem despejava uma URL por peça. Quatro links crus numa mensagem
-- de WhatsApp parecem disparo, e nenhum deles carrega a identificação da
-- propaganda nem o botão de sair — as duas coisas que sustentam a defesa.
--
-- Agora vai `{{link}}`: a página daquele candidato, com as peças dentro, o
-- CNPJ visível e o descadastro. Cada peça lá dentro continua com link próprio,
-- então a medição por peça não se perde.
--
-- O convite ao canal segue com `{{materiais}}`: ali o objetivo é a pessoa cair
-- DENTRO do canal, não numa página sobre ele.

update public.variacoes v
   set texto = replace(v.texto, '{{materiais}}', '{{link}}')
  from public.modelos m
 where m.id = v.modelo_id
   and m.etapa = 'material'
   and v.texto like '%{{materiais}}%';
