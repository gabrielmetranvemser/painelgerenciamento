-- =============================================================================
-- A saudação deixa de cair no meio da frase
-- =============================================================================
-- Duas variações escreviam "Oi, {{primeiro_nome}}, {{saudacao}}!", que sai
-- "Oi, Joana, Boa tarde!" — maiúscula no meio do período. O texto de
-- {{saudacao}} é capitalizado porque quase sempre abre a mensagem; aqui a
-- correção é a posição, não a variável.
update public.variacoes v
   set texto = replace(v.texto,
         'Oi, {{primeiro_nome}}, {{saudacao}}! Sou {{nome}}.',
         'Oi, {{primeiro_nome}}! {{saudacao}}. Sou {{nome}}.')
  from public.modelos m
 where m.id = v.modelo_id and m.etapa = 'permissao';

update public.variacoes v
   set texto = replace(v.texto,
         'Oi, {{primeiro_nome}}, {{saudacao}}, tudo bem por aí?',
         'Oi, {{primeiro_nome}}! {{saudacao}}, tudo bem por aí?')
  from public.modelos m
 where m.id = v.modelo_id and m.etapa = 'permissao';

do $$
declare v_ruim int;
begin
  select count(*) into v_ruim
    from public.variacoes v join public.modelos m on m.id = v.modelo_id
   where m.etapa = 'permissao' and v.ativa
     and (v.texto like '%, {{saudacao}}%'
          -- maiúscula depois de vírgula: o mesmo defeito, escrito à mão
          or v.texto ~ ', [A-ZÀ-Ú]');
  if v_ruim > 0 then
    raise exception '% variações têm maiúscula no meio da frase', v_ruim;
  end if;
end $$;
