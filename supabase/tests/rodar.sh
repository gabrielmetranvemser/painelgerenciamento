#!/usr/bin/env bash
# Roda a suíte inteira contra o banco.
#
#   npm run test:banco
#
# 02 e 03 são autossuficientes (criam os próprios dados e dão rollback).
# O de concorrência precisa de dados COMMITADOS, porque usa várias conexões —
# por isso cria fixtures antes e limpa depois.
set -uo pipefail
cd "$(dirname "$0")/../.."

: "${SUPABASE_DB_URL:?defina SUPABASE_DB_URL (está no .env.local)}"
export PGCONNECT_TIMEOUT=20
# ⚠️ ON_ERROR_STOP=1 não é opcional: sem ele o psql sai com código 0 mesmo
# quando uma instrução falha, e este runner reportava TUDO VERDE com teste
# quebrado. Foi assim que a falha do 02_travas passou despercebida.
PSQL=(psql "$SUPABASE_DB_URL" -qX -v ON_ERROR_STOP=1)

falhou=0

echo "── Travas de servidor ───────────────────────────────────────────────────"
"${PSQL[@]}" -f supabase/tests/02_travas.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
echo "── Automações ───────────────────────────────────────────────────────────"
"${PSQL[@]}" -f supabase/tests/03_automacoes.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
echo "── Consentimento e roteamento ───────────────────────────────────────────"
"${PSQL[@]}" -f supabase/tests/06_consentimento.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
echo "── Candidatos e atribuição ──────────────────────────────────────────────"
"${PSQL[@]}" -f supabase/tests/05_candidatos.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
echo "── Perfil do contato ────────────────────────────────────────────────────"
"${PSQL[@]}" -f supabase/tests/04_perfil.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/07_captacao_por_candidato.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/08_pular_e_entrega.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/09_termo.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/10_rls.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/11_suporte.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/12_adicionar_contato.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/13_altos.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/14_medios.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/15_listas.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/16_contatos.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/17_chapa_e_desfechos.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/18_cadastros_do_gestor.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/19_escolher_contato.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/20_rampa_e_variacao.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/21_reimportacao.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/22_apagar_lista.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/23_pular_intervalo.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/24_grupos_de_lista.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/25_autorizou_libera_material.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
"${PSQL[@]}" -f supabase/tests/26_dominio_por_candidato.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
echo "── Concorrência da fila ─────────────────────────────────────────────────"

# ⚠️ Este é o único bloco que precisa de dados COMMITADOS — são várias conexões
# ao mesmo tempo, e uma transação com rollback não é visível para as outras.
#
# Consequência chata: os outros arquivos abrem a janela de horário dentro da
# própria transação, e este não pode. Sem tratamento, a suíte inteira só rodava
# entre 9h e 20h de Porto Velho, porque as travas de verdade recusam envio fora
# do horário — e ninguém sobe código às 9h da manhã.
#
# Então a janela é aberta de fato e devolvida por um `trap`, que dispara também
# se o script morrer no meio. A janela original vai para variável de shell, não
# para o banco: se o processo cair, o próprio trap devolve; e se a máquina
# desligar no meio, a config fica ABERTA — por isso o aviso alto abaixo, para
# ninguém descobrir isso no dia seguinte pelo comportamento do painel.
JANELA=$("${PSQL[@]}" -At -c "select hora_inicio || ' ' || hora_fim from public.config where id = 1")
JANELA_INI=${JANELA% *}
JANELA_FIM=${JANELA#* }

restaurar_janela() {
  "${PSQL[@]}" -c "update public.config set hora_inicio = $JANELA_INI, hora_fim = $JANELA_FIM where id = 1" >/dev/null 2>&1
}
trap 'restaurar_janela' EXIT INT TERM

echo "  (abrindo a janela de horário — ${JANELA_INI}h–${JANELA_FIM}h volta no fim)"
"${PSQL[@]}" -c "update public.config set hora_inicio = 0, hora_fim = 24 where id = 1" >/dev/null

"${PSQL[@]}" -f supabase/tests/99_limpeza.sql >/dev/null 2>&1
if "${PSQL[@]}" -f supabase/tests/01_fixtures.sql >/dev/null 2>&1; then
  PGPASSWORD="" PSQL_URL="$SUPABASE_DB_URL" ./supabase/tests/concorrencia.sh || falhou=1
else
  # ⚠️ A mensagem antiga era só "não consegui criar os fixtures", e ela custou
  # meia hora: a causa real (um contato de teste com o mesmo telefone, criado
  # pela tela) estava no erro do psql, que era jogado fora com o 2>&1 >/dev/null.
  echo "  ❌ não consegui criar os fixtures. O erro:"
  "${PSQL[@]}" -f supabase/tests/01_fixtures.sql 2>&1 | sed 's/^/     /' | tail -5
  falhou=1
fi
"${PSQL[@]}" -f supabase/tests/99_limpeza.sql >/dev/null 2>&1
restaurar_janela
trap - EXIT INT TERM
echo "  (fixtures removidos, janela de horário devolvida a ${JANELA_INI}h–${JANELA_FIM}h)"

echo
[ "$falhou" = 0 ] && echo "TUDO VERDE ✅" || { echo "HOUVE FALHA ❌"; exit 1; }
