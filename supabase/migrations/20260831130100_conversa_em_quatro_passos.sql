-- =============================================================================
-- A conversa em quatro passos, e o intervalo só no primeiro
-- =============================================================================
-- Continuação de `etapas_abertura_e_minha_escolha`, que só criou os valores do
-- enum. Aqui entram os modelos, os textos iniciais e a mudança que faz a coisa
-- funcionar no dia a dia.
--
-- ── O INTERVALO PASSA A VALER SÓ NA ABERTURA ────────────────────────────────
--
-- `etapa_de_abordagem` decide quem espera o intervalo entre mensagens. Ela
-- listava `permissao`, `material` e `convite_grupo` — o que fazia sentido
-- quando a permissão era a PRIMEIRA mensagem. Com quatro passos, manter isso
-- obrigaria o atendente a esperar o intervalo três vezes DENTRO DA MESMA
-- conversa: com 120 segundos configurados, seis minutos para falar com uma
-- pessoa que já respondeu.
--
-- O intervalo existe para o WhatsApp não ver o mesmo número abrindo conversa
-- com trinta desconhecidos em sequência. Quem já respondeu não é desconhecido:
-- é uma conversa em andamento, e conversa em andamento não é o padrão que o
-- antispam procura. Então o espaçamento fica onde o risco está — na PRIMEIRA
-- mensagem para cada pessoa.
--
-- O teto diário não muda e continua sendo a trava de volume: ele conta PESSOAS
-- distintas por número por dia, não mensagens. Falar com alguém em quatro
-- passos gasta uma conversa, não quatro.
--
-- ⚠️ Efeito colateral aceito, e vale escrever: o envio do material deixa de ser
-- espaçado. Numa chapa de três candidatos, os três links podem sair em
-- sequência. Quem decidiu foi quem opera; se o número começar a sentir, o
-- caminho de volta é acrescentar 'material' à lista aqui.

create or replace function public.etapa_de_abordagem(p_etapa public.etapa_msg)
returns boolean
language sql immutable
as $$
  select p_etapa = 'abertura';
$$;

-- ── Os dois modelos novos ───────────────────────────────────────────────────
insert into public.modelos (etapa, nome, ativo)
values ('abertura',      'Abertura — só o oi',            true),
       ('minha_escolha', 'Minha escolha — o coração',     true)
on conflict (etapa) do nothing;

-- ── Textos iniciais ─────────────────────────────────────────────────────────
-- Saem do roteiro que a campanha já usa no papel. Três variações na abertura
-- porque é a mensagem que mais se repete no mesmo número, e a rotação por chip
-- existe exatamente para ela.
--
-- Sem link, sem emoji e sem nome de candidato na Abertura: é um "oi". Quem
-- emenda o assunto no "oi" está mandando panfleto, não conversando.
insert into public.variacoes (modelo_id, texto, ordem, ativa)
select m.id, t.texto, t.ordem, true
  from public.modelos m
  join (values
    (1, '{{saudacao}}, {{primeiro_nome}}! Tudo bem?'),
    (2, 'Oi, {{primeiro_nome}}! Quanto tempo. Tudo bem por aí?'),
    (3, '{{saudacao}}, {{primeiro_nome}}! Tudo certo?')
  ) as t(ordem, texto) on true
 where m.etapa = 'abertura'
   and not exists (select 1 from public.variacoes v where v.modelo_id = m.id);

-- A escolha é do ATENDENTE, contada na primeira pessoa. É o que separa "eu
-- decidi meu voto e quis te contar" de "a campanha está te mandando material" —
-- e é a diferença entre conversa entre pessoas e propaganda.
insert into public.variacoes (modelo_id, texto, ordem, ativa)
select m.id, t.texto, t.ordem, true
  from public.modelos m
  join (values
    (1, 'Que bom! Então, eu tô te chamando porque já decidi meu voto e resolvi contar pras pessoas que eu gosto. Escolhi {{candidatos}}.'),
    (2, 'Ó, tava querendo te falar uma coisa. Já decidi meu voto e escolhi {{candidatos}}. Como eu confio em você, quis te contar.')
  ) as t(ordem, texto) on true
 where m.etapa = 'minha_escolha'
   and not exists (select 1 from public.variacoes v where v.modelo_id = m.id);

-- ── A Permissão encolhe ─────────────────────────────────────────────────────
-- Ela não é mais a primeira mensagem: quem se apresentou foi a Abertura, e quem
-- contou a escolha foi o passo 2. O que sobra para ela é o que só ela pode
-- fazer — declarar a chapa inteira, dizer de onde veio o contato e PEDIR.
--
-- Os textos que já estão lá continuam valendo e não são reescritos: são do
-- gestor, e ele acabou de mexer neles. O que entra é uma variação nova, curta,
-- desligada — para ele comparar e decidir.
insert into public.variacoes (modelo_id, texto, ordem, ativa)
select m.id,
       'Posso te mandar o material {{candidatos}} pra você dar uma olhada? '
       'Cheguei até você porque {{origem}} — se não quiser, me fala que apago seu número.',
       coalesce((select max(v.ordem) from public.variacoes v where v.modelo_id = m.id), 0) + 1,
       false
  from public.modelos m
 where m.etapa = 'permissao'
   and not exists (
     select 1 from public.variacoes v
      where v.modelo_id = m.id and v.texto like 'Posso te mandar o material%'
   );

-- ── Ordem de leitura das etapas ─────────────────────────────────────────────
-- Existe para a tela do gestor e o histórico do contato ordenarem igual sem
-- repetir a lista em JavaScript. A ordem do enum já está certa (os dois novos
-- entraram ANTES de 'permissao'), então basta expô-la.
create or replace function public.ordem_da_etapa(p_etapa public.etapa_msg)
returns int
language sql immutable
as $$
  select array_position(enum_range(null::public.etapa_msg), p_etapa)::int;
$$;

grant execute on function public.ordem_da_etapa(public.etapa_msg) to authenticated;
