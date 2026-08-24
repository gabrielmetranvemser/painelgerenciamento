-- =============================================================================
-- A prova de o que foi mandado deixa de vir do navegador
-- =============================================================================
-- ⚠️ `interacoes.texto_enviado` é a peça de auditoria do sistema: é o que
--    responde "o que exatamente esta campanha escreveu para esta pessoa". É o
--    que se mostra se alguém questionar o conteúdo de uma abordagem.
--
-- E ele chegava como PARÂMETRO DA TELA. `registrarAbertura(…, texto, …)` recebia
-- o texto do componente e o repassava ao banco. Ou seja: quem tinha interesse em
-- registrar uma coisa diferente da que mandou era exatamente quem preenchia o
-- campo. Um atendente com o DevTools aberto escrevia qualquer promessa na
-- conversa do WhatsApp e gravava no log o texto aprovado pelo gestor.
--
-- Não dá para o Postgres montar o texto sozinho: as variáveis são substituídas
-- em Node, por `montarTexto`, que é a função que os testes cobrem e que conhece
-- saudação, fuso, chapa e origem. Então a correção é de CAMINHO, não de lugar:
--
--   o servidor Node monta o texto (o mesmo que vai para a tela e para a URL do
--   WhatsApp) e o grava AQUI, no ato de preparar. Abrir a conversa passa a só
--   carimbar a hora. O navegador deixa de ter o que dizer sobre o assunto.
--
-- A gravação só alcança rascunho — linha com `aberto_wa_em` nulo. Depois de a
-- conversa ter sido aberta, o texto é história e não se reescreve.

create or replace function public.gravar_texto_preparado(
  p_contato_id   uuid,
  p_etapa        public.etapa_msg,
  p_candidato_id uuid,
  p_texto        text
)
returns jsonb
language plpgsql security definer set search_path = ''
as $$
declare
  v_uid     uuid := (select auth.uid());
  v_contato public.contatos%rowtype;
begin
  select * into v_contato from public.contatos where id = p_contato_id;
  if v_contato.id is null or v_contato.atendente_id <> v_uid then
    return jsonb_build_object('ok', false, 'motivo', 'contato_nao_e_seu');
  end if;

  update public.interacoes
     set texto_enviado = p_texto
   where contato_id = p_contato_id
     and etapa = p_etapa
     and candidato_id is not distinct from p_candidato_id
     -- Só rascunho. Texto de conversa já aberta é registro, não campo.
     and aberto_wa_em is null;

  return jsonb_build_object('ok', true);
end;
$$;

revoke execute on function public.gravar_texto_preparado(uuid, public.etapa_msg, uuid, text)
  from anon, public;
grant  execute on function public.gravar_texto_preparado(uuid, public.etapa_msg, uuid, text)
  to authenticated;
