-- Domínio próprio por candidato.
-- AUTOSSUFICIENTE: cria os próprios dados e dá ROLLBACK.
--
-- ⚠️ OS TESTES 5 E 6 SÃO OS QUE IMPORTAM.
--
-- O 5 vigia o gatilho: trocar o domínio tem de APAGAR o carimbo de verificação.
-- Sem ele, editar `material.sofia…` para `campanha.sofia…` herdaria o carimbo
-- do endereço anterior — e o painel passaria a mandar links num domínio que
-- nunca foi testado. O sintoma seria invisível: o envio é registrado igual, e o
-- que some é o clique, que é a única prova de que a pessoa abriu o material.
--
-- O 6 vigia o contrário: mexer em QUALQUER outro campo não pode zerar a
-- verificação. Se zerasse, uma troca de cor derrubaria o domínio para o
-- endereço padrão sem ninguém pedir, e o gestor descobriria pelo link errado
-- numa conversa.
begin;

do $$
declare
  v_a      uuid;
  v_b      uuid;
  v_falhas int := 0;
begin
  raise notice '── Domínio por candidato ────────────────────────────────────────────────';

  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-dom-1', 'Dom Um', 'deputado_federal', 1, '9951', 'RO', true)
  returning id into v_a;
  insert into public.candidatos (slug, nome_urna, cargo, vaga, numero, uf, ativo)
  values ('teste-dom-2', 'Dom Dois', 'deputado_federal', 1, '9952', 'RO', true)
  returning id into v_b;

  -- =========================================================================
  -- 1 · Um host normal entra
  -- =========================================================================
  update public.candidatos set dominio = 'material.exemplo.com.br' where id = v_a;
  if (select dominio from public.candidatos where id = v_a) = 'material.exemplo.com.br' then
    raise notice '  ✅ 1. host válido é aceito';
  else raise warning '  ❌ 1. não gravou'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 2 · O que NÃO é host é recusado pelo banco
  -- =========================================================================
  begin
    update public.candidatos set dominio = 'https://material.exemplo.com.br/' where id = v_b;
    raise warning '  ❌ 2. aceitou endereço com esquema e barra'; v_falhas := v_falhas + 1;
  exception when check_violation then
    raise notice '  ✅ 2. endereço com esquema/barra é recusado (nunca casaria com o Host)';
  end;

  begin
    update public.candidatos set dominio = 'Material.Exemplo.com.br' where id = v_b;
    raise warning '  ❌ 2b. aceitou maiúscula'; v_falhas := v_falhas + 1;
  exception when check_violation then
    raise notice '  ✅ 2b. maiúscula é recusada — a comparação com o Host é byte a byte';
  end;

  -- =========================================================================
  -- 3 · Dois candidatos no mesmo host: o painel teria de adivinhar
  -- =========================================================================
  begin
    update public.candidatos set dominio = 'material.exemplo.com.br' where id = v_b;
    raise warning '  ❌ 3. aceitou o mesmo domínio em dois candidatos'; v_falhas := v_falhas + 1;
  exception when unique_violation then
    raise notice '  ✅ 3. domínio repetido em outro candidato é recusado';
  end;

  -- =========================================================================
  -- 4 · O carimbo de verificação é gravável
  -- =========================================================================
  update public.candidatos set dominio_verificado_em = now() where id = v_a;
  if (select dominio_verificado_em from public.candidatos where id = v_a) is not null then
    raise notice '  ✅ 4. verificação carimbada';
  else raise warning '  ❌ 4. não carimbou'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 5 · ⚠️ TROCAR O DOMÍNIO APAGA O CARIMBO
  -- =========================================================================
  update public.candidatos set dominio = 'kit.exemplo.com.br' where id = v_a;
  if (select dominio_verificado_em from public.candidatos where id = v_a) is null then
    raise notice '  ✅ 5. trocar o domínio zera a verificação';
  else raise warning '  ❌ 5. CARIMBO HERDADO: o painel jura ter testado um endereço que nunca viu';
       v_falhas := v_falhas + 1;
  end if;

  -- E tirar o domínio também.
  update public.candidatos set dominio_verificado_em = now() where id = v_a;
  update public.candidatos set dominio = null where id = v_a;
  if (select dominio_verificado_em from public.candidatos where id = v_a) is null then
    raise notice '  ✅ 5b. apagar o domínio zera a verificação junto';
  else raise warning '  ❌ 5b. sobrou carimbo sem domínio'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 6 · ⚠️ MEXER EM OUTRO CAMPO NÃO PODE ZERAR
  -- =========================================================================
  -- Em DUAS instruções, como o painel faz: salvar o candidato grava o domínio,
  -- e só o "Conferir" carimba a verificação.
  --
  -- ⚠️ Numa instrução só o gatilho ganha e o carimbo sai nulo — é ele que roda
  -- por último. Isso é o lado SEGURO do erro (o domínio fica por conferir em
  -- vez de nascer verificado sem teste), mas quem for gravar as duas colunas
  -- juntas um dia precisa saber que o carimbo não sobrevive.
  update public.candidatos set dominio = 'material.exemplo.com.br' where id = v_a;
  update public.candidatos set dominio_verificado_em = now() where id = v_a;
  update public.candidatos set cor_tema = '#123456', slogan = 'Outro' where id = v_a;
  if (select dominio_verificado_em from public.candidatos where id = v_a) is not null then
    raise notice '  ✅ 6. editar cor ou slogan não derruba o domínio verificado';
  else raise warning '  ❌ 6. DERRUBOU O DOMÍNIO numa edição que não tinha nada a ver';
       v_falhas := v_falhas + 1;
  end if;

  -- Regravar o MESMO domínio é um "update" que não muda nada: não pode zerar.
  update public.candidatos set dominio = 'material.exemplo.com.br' where id = v_a;
  if (select dominio_verificado_em from public.candidatos where id = v_a) is not null then
    raise notice '  ✅ 7. salvar de novo o mesmo domínio mantém a verificação';
  else raise warning '  ❌ 7. zerou sem o domínio ter mudado'; v_falhas := v_falhas + 1;
  end if;

  -- =========================================================================
  -- 8 · Nulo é o normal: quase todo candidato não tem domínio próprio
  -- =========================================================================
  if (select count(*) from public.candidatos where id = v_b and dominio is null) = 1 then
    raise notice '  ✅ 8. candidato sem domínio próprio é estado válido';
  else raise warning '  ❌ 8. exigiu domínio'; v_falhas := v_falhas + 1;
  end if;

  if v_falhas = 0 then raise notice 'DOMÍNIO POR CANDIDATO: ✅ as 9 passaram';
  else raise exception 'DOMÍNIO POR CANDIDATO: ❌ % falha(s)', v_falhas;
  end if;
end $$;

rollback;
