-- =============================================================================
-- Índices
-- =============================================================================

-- ── Dedup: as duas travas, no banco ─────────────────────────────────────────
-- Primeira trava: o HMAC. É a mais forte porque SOBREVIVE à purga de 48h —
-- um número apagado não consegue voltar numa importação futura.
create unique index contatos_hmac_uk on public.contatos (telefone_hmac);

-- Segunda trava: a chave normalizada. Redundante de propósito. Se algum dia o
-- HMAC for gerado errado (chave trocada, bug no servidor), esta ainda pega o
-- número repetido antes de dois atendentes ligarem para a mesma pessoa.
create unique index contatos_chave_dedup_uk
  on public.contatos (chave_dedup)
  where chave_dedup is not null;

-- ── Fila ────────────────────────────────────────────────────────────────────
create index contatos_fila_idx
  on public.contatos (origem, criado_em)
  where status = 'na_fila';

create index contatos_atendente_idx on public.contatos (atendente_id, status);
create index contatos_chip_idx      on public.contatos (chip_id, status);
create index contatos_lease_idx
  on public.contatos (claim_expira_em)
  where status = 'em_atendimento';
create index contatos_municipio_idx on public.contatos (municipio_id);
create index contatos_lista_idx     on public.contatos (lista_id);

-- ── Teto diário e intervalo (caminho quente da fila) ────────────────────────
-- Sustenta as duas contas derivadas: quantos contatos distintos este chip já
-- abriu hoje, e quando foi a última abertura.
create index interacoes_chip_dia_idx
  on public.interacoes (chip_id, dia_operacional, aberto_wa_em desc)
  where aberto_wa_em is not null;

create index interacoes_contato_idx   on public.interacoes (contato_id);
create index interacoes_atendente_idx on public.interacoes (atendente_id, dia_operacional);
create index interacoes_resultado_idx on public.interacoes (resultado, resultado_em);

-- ── Links e cliques ─────────────────────────────────────────────────────────
create index links_contato_idx on public.links (contato_id);

-- O relatório só olha clique de gente: índice parcial sobre is_bot = false.
create index cliques_reais_idx
  on public.cliques (token, ts desc)
  where is_bot = false;

-- ── Manutenção ──────────────────────────────────────────────────────────────
create index bloqueios_apagar_idx on public.bloqueios (apagar_em);
create index variacoes_modelo_idx on public.variacoes (modelo_id, ordem) where ativa;
create index alertas_abertos_idx  on public.alertas (criado_em desc) where resolvido_em is null;
