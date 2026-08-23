-- =============================================================================
-- Dados iniciais
-- =============================================================================

-- ── Configuração ────────────────────────────────────────────────────────────
insert into public.config (id, timezone, teto_diario, hora_inicio, hora_fim, intervalo_seg, termo_texto)
values (1, 'America/Porto_Velho', 30, 9, 20, 90,
$termo$Ao aceitar, eu declaro que:

- Envio as mensagens manualmente, pelo meu WhatsApp. Não uso robô, extensão de envio nem lista de transmissão.
- Primeiro peço permissão. Só mando o material depois do "pode". Faço uma tentativa por pessoa e não insisto.
- Respeito o teto diário e o horário. Não falo com ninguém no dia da eleição.
- No meu perfil fica só o meu primeiro nome e a minha foto. Nunca foto do candidato, de apoiador ou de material de campanha.
- Não salvo os contatos na agenda, não encaminho listas, não coloco ninguém em grupo e não tiro print das conversas.
- Não prometo nada a ninguém: emprego, dinheiro ou favor.
- Não anoto em quem a pessoa vota, em lugar nenhum.
- Ao fim da campanha, apago as conversas.
- Os dados são da campanha e são sigilosos. Uso apenas para este atendimento.

Eu entendo que o número que aparece numa eventual denúncia é o MEU, e que este termo protege a campanha. Entendo também que não sou remunerado por mensagem enviada.$termo$)
on conflict (id) do nothing;

-- ── Municípios de Rondônia ──────────────────────────────────────────────────
-- Lista fechada para o relatório por município sair confiável.
insert into public.municipios (uf, nome) values
  ('RO','Alta Floresta d''Oeste'), ('RO','Alto Alegre dos Parecis'), ('RO','Alto Paraíso'),
  ('RO','Alvorada d''Oeste'), ('RO','Ariquemes'), ('RO','Buritis'), ('RO','Cabixi'),
  ('RO','Cacaulândia'), ('RO','Cacoal'), ('RO','Campo Novo de Rondônia'),
  ('RO','Candeias do Jamari'), ('RO','Castanheiras'), ('RO','Cerejeiras'),
  ('RO','Chupinguaia'), ('RO','Colorado do Oeste'), ('RO','Corumbiara'),
  ('RO','Costa Marques'), ('RO','Cujubim'), ('RO','Espigão d''Oeste'),
  ('RO','Governador Jorge Teixeira'), ('RO','Guajará-Mirim'), ('RO','Itapuã do Oeste'),
  ('RO','Jaru'), ('RO','Ji-Paraná'), ('RO','Machadinho d''Oeste'),
  ('RO','Ministro Andreazza'), ('RO','Mirante da Serra'), ('RO','Monte Negro'),
  ('RO','Nova Brasilândia d''Oeste'), ('RO','Nova Mamoré'), ('RO','Nova União'),
  ('RO','Novo Horizonte do Oeste'), ('RO','Ouro Preto do Oeste'), ('RO','Parecis'),
  ('RO','Pimenta Bueno'), ('RO','Pimenteiras do Oeste'), ('RO','Porto Velho'),
  ('RO','Presidente Médici'), ('RO','Primavera de Rondônia'), ('RO','Rio Crespo'),
  ('RO','Rolim de Moura'), ('RO','Santa Luzia d''Oeste'), ('RO','São Felipe d''Oeste'),
  ('RO','São Francisco do Guaporé'), ('RO','São Miguel do Guaporé'), ('RO','Seringueiras'),
  ('RO','Teixeirópolis'), ('RO','Theobroma'), ('RO','Urupá'), ('RO','Vale do Anari'),
  ('RO','Vale do Paraíso'), ('RO','Vilhena')
on conflict (uf, nome) do nothing;

-- ── Destinos dos links ──────────────────────────────────────────────────────
-- O gestor troca a URL sem trocar os tokens já enviados.
insert into public.destinos (chave, nome, url) values
  ('material', 'Material da campanha', 'https://exemplo.invalid/material'),
  ('canal',    'Canal do WhatsApp',    'https://exemplo.invalid/canal')
on conflict (chave) do nothing;

-- ── Modelos e variações ─────────────────────────────────────────────────────
-- Textos de docs/03-OPERACAO.md §8. Passam na validação de blocos travados
-- (ver src/lib/mensagem.test.ts, que roda contra estes textos literais).
insert into public.modelos (etapa, nome) values
  ('permissao',      'Pedido de permissão'),
  ('material',       'Envio do material'),
  ('saida',          'Confirmação de saída'),
  ('quem_passou',    'Quem passou meu número'),
  ('quer_ajudar',    'Quer ajudar'),
  ('encaminhamento', 'Encaminhamento'),
  ('convite_grupo',  'Convite ao canal')
on conflict (etapa) do nothing;

insert into public.variacoes (modelo_id, texto, ordem)
select m.id, v.texto, v.ordem
from public.modelos m
join (values
  ('permissao', 1, '{{saudacao}}, {{primeiro_nome}}! Tudo bem? Aqui é {{nome}}. Tô ajudando o(a) {{candidato}} nessa eleição pra {{cargo}}, e um apoiador dele(a) me passou seu contato. Posso te mandar o material aqui? Se não quiser, me fala que eu paro por aqui e apago seu número, tranquilo.'),
  ('permissao', 2, 'Oi, {{primeiro_nome}}, {{saudacao}}! Sou {{nome}}. Tô com o(a) {{candidato}} nessa eleição, ele(a) tá concorrendo a {{cargo}}. Um apoiador dele(a) me passou seu contato. Tudo bem se eu te mandar as propostas? Se preferir não receber, é só me dizer que apago seu contato.'),
  ('permissao', 3, '{{saudacao}}, {{primeiro_nome}}, tudo certo? {{nome}} aqui. Tô dando uma força pro(a) {{candidato}}, candidato(a) a {{cargo}}, e um apoiador dele(a) me indicou seu contato. Posso te mostrar o material por aqui? Se não quiser, sem problema, me avisa que apago seu número.'),
  ('permissao', 4, '{{saudacao}}, {{primeiro_nome}}! Aqui é {{nome}}. Tô ajudando o(a) {{candidato}} ({{cargo}}) e um apoiador me passou seu contato. Te mando o material? Se não quiser, me fala que apago seu número e não te chamo mais.'),
  ('permissao', 5, 'Oi, {{primeiro_nome}}, {{saudacao}}, tudo bem por aí? Eu sou {{nome}}, tô nessa eleição ajudando o(a) {{candidato}} pra {{cargo}}. Um apoiador dele(a) me passou seu contato. Posso te mandar as propostas aqui no WhatsApp? Se preferir que não, me fala que apago seu contato, de boa.'),
  ('material', 1, 'Que bom, {{primeiro_nome}}! Esse é o material do(a) {{candidato}} – {{cargo}} – nº {{numero}}: {{link}}. Só pra eu te mandar as coisas da sua região: você é de qual cidade? Se quiser acompanhar de perto, tem o canal da campanha, entra só se quiser: {{link_grupo}}. E se um dia não quiser mais receber, me avisa que apago seu contato.'),
  ('saida', 1, 'Tranquilo, {{primeiro_nome}}. Já tirei seu número da lista e ele será apagado em até 48h. Obrigado(a) por responder!'),
  ('quem_passou', 1, 'Foi um apoiador do(a) {{candidato}} que tem seu contato. Se preferir, apago seu número agora e não te chamo mais.'),
  ('quer_ajudar', 1, 'Que ótimo, {{primeiro_nome}}! Posso passar seu contato pra coordenação te chamar?'),
  ('encaminhamento', 1, 'Isso eu não posso prometer, e a lei não permite. O que posso é levar sua pergunta pra equipe, tudo bem?'),
  ('convite_grupo', 1, 'Tem sim! Eu não adiciono ninguém, você entra pelo link, assim fica no seu controle: {{link_grupo}}. Se um dia quiser sair, é só sair.')
) as v(etapa, ordem, texto) on v.etapa = m.etapa::text
where not exists (select 1 from public.variacoes x where x.modelo_id = m.id);
