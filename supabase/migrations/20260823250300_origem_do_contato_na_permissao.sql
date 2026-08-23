-- =============================================================================
-- A Permissão passa a dizer a VERDADE sobre como chegamos no contato
-- =============================================================================
-- Os cinco textos da Permissão nasceram para a lista fria e diziam, escrito à
-- mão, "um apoiador me passou seu contato". Quando a página do candidato entrou
-- no ar, quem preenche o formulário com o próprio dedo passou a receber essa
-- mesma frase — uma afirmação falsa sobre a procedência do dado dita para a
-- pessoa de quem o dado é.
--
-- Agora a frase é `{{origem}}`, resolvida pelo servidor a partir da origem do
-- contato. Deixa de ser texto livre porque é afirmação de fato, e é o tipo de
-- coisa que não se deixa alguém escrever errado sem perceber.

update public.variacoes v
   set texto = regexp_replace(
         v.texto,
         '[Uu]m apoiador me (passou|indicou) seu contato',
         '{{origem}}', 'g')
  from public.modelos m
 where m.id = v.modelo_id
   and m.etapa = 'permissao';

-- Em duas variações a frase era oração isolada ("Um apoiador me passou seu
-- contato."). Emendadas na anterior: a variável entra sempre no MEIO da frase,
-- porque o texto dela começa em minúscula e virar início de período sairia
-- "um apoiador me passou..." com minúscula.
update public.variacoes v
   set texto = replace(v.texto, '{{candidatos}}. {{origem}}.', '{{candidatos}}, e {{origem}}.')
  from public.modelos m
 where m.id = v.modelo_id and m.etapa = 'permissao';

-- Confere que nenhuma sobrou sem a variável.
do $$
declare v_faltando int;
begin
  select count(*) into v_faltando
    from public.variacoes v join public.modelos m on m.id = v.modelo_id
   where m.etapa = 'permissao' and v.ativa and v.texto not like '%{{origem}}%';
  if v_faltando > 0 then
    raise exception 'Ficaram % variações de Permissão sem {{origem}}', v_faltando;
  end if;
end $$;

-- A resposta a "quem passou meu número?" tem o mesmo problema.
update public.variacoes v
   set texto = 'Foi assim: {{origem}}. Se preferir, apago seu número agora e não te chamo mais.'
  from public.modelos m
 where m.id = v.modelo_id and m.etapa = 'quem_passou';

do $$
declare v_ruim int;
begin
  select count(*) into v_ruim
    from public.variacoes v join public.modelos m on m.id = v.modelo_id
   where m.etapa = 'permissao' and v.ativa
     and (v.texto like '%. {{origem}}%' or v.texto like '{{origem}}%');
  if v_ruim > 0 then
    raise exception '% variações começam período com {{origem}} — sairia em minúscula', v_ruim;
  end if;
end $$;
