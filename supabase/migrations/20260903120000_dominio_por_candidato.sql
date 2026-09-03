-- =============================================================================
-- Um domínio próprio por candidato, para a página pública dele
-- =============================================================================
-- Pedido de quem opera: o painel continua no endereço da Vercel, mas o link de
-- captação que a campanha divulga e manda no WhatsApp passa a ser
-- `material.sofiaandrade.com.br` em vez de `…vercel.app/sofia-andrade`.
--
-- ⚠️ POR QUE EXISTEM DUAS COLUNAS, E NÃO UMA.
--
-- `dominio` é o que o gestor DIGITOU. `dominio_verificado_em` é a data em que o
-- painel confirmou, sozinho, que aquele endereço responde e responde por ESTE
-- candidato. Só a segunda libera o uso do domínio nos links.
--
-- A razão é o modo de falha. Entre digitar o domínio aqui e o DNS de terceiro
-- propagar existe uma janela de horas. Se o painel confiasse no que foi
-- digitado, toda mensagem enviada nessa janela sairia com um link que não
-- abre — e ninguém descobriria: o envio é registrado normalmente, o clique
-- simplesmente nunca chega. Como o clique é a única métrica que este sistema
-- controla de verdade (e a prova de consentimento), o prejuízo seria invisível
-- e permanente. É o mesmo defeito que `enderecoBase()` foi reescrito para
-- impedir, e a resposta é a mesma: na dúvida, usar o endereço que sabidamente
-- funciona.
--
-- ⚠️ O GATILHO NÃO É ENFEITE. Trocar o domínio zera a verificação. Sem ele,
-- editar `material.sofia…` para `campanha.sofia…` herdaria o carimbo do
-- endereço ANTERIOR — o painel passaria a jurar que confirmou um domínio que
-- nunca testou. Fica no banco, e não na ação do gestor, porque é a única
-- camada que ninguém consegue esquecer de chamar.

alter table public.candidatos
  add column if not exists dominio text,
  add column if not exists dominio_verificado_em timestamptz;

comment on column public.candidatos.dominio is
  'Host próprio da página pública deste candidato, sem esquema e sem barra: '
  '"material.sofiaandrade.com.br". Só entra nos links depois de verificado.';
comment on column public.candidatos.dominio_verificado_em is
  'Quando o painel confirmou que este host responde por ESTE candidato. '
  'Nulo = ainda não confirmado, e os links continuam saindo no endereço padrão.';

-- Host, em minúsculas, com pelo menos dois rótulos e um sufixo de letras.
-- Sem esquema, sem porta, sem caminho: o que entra aqui é comparado byte a byte
-- com o cabeçalho `Host` da requisição, então qualquer sujeira vira um domínio
-- que nunca casa e um defeito difícil de enxergar.
alter table public.candidatos
  drop constraint if exists dominio_e_um_host;
alter table public.candidatos
  add constraint dominio_e_um_host check (
    dominio is null or (
      dominio = lower(dominio)
      and length(dominio) between 4 and 253
      and dominio ~ '^[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)+$'
      and dominio ~ '\.[a-z]{2,}$'
    )
  );

-- Dois candidatos no mesmo host seria o painel tendo de adivinhar de quem é a
-- página. O índice recusa antes de a dúvida existir.
create unique index if not exists candidatos_dominio_uk
  on public.candidatos (dominio) where dominio is not null;

create or replace function public.dominio_trocado_perde_a_verificacao()
returns trigger
language plpgsql set search_path = ''
as $$
begin
  if new.dominio is distinct from old.dominio then
    new.dominio_verificado_em := null;
  end if;
  return new;
end;
$$;

drop trigger if exists dominio_trocado_perde_a_verificacao on public.candidatos;
create trigger dominio_trocado_perde_a_verificacao
  before update of dominio on public.candidatos
  for each row execute function public.dominio_trocado_perde_a_verificacao();
