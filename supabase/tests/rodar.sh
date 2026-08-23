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
echo "── Concorrência da fila ─────────────────────────────────────────────────"
"${PSQL[@]}" -f supabase/tests/99_limpeza.sql >/dev/null 2>&1
if "${PSQL[@]}" -f supabase/tests/01_fixtures.sql >/dev/null 2>&1; then
  PGPASSWORD="" PSQL_URL="$SUPABASE_DB_URL" ./supabase/tests/concorrencia.sh || falhou=1
else
  echo "  ❌ não consegui criar os fixtures"; falhou=1
fi
"${PSQL[@]}" -f supabase/tests/99_limpeza.sql >/dev/null 2>&1
echo "  (fixtures removidos)"

echo
[ "$falhou" = 0 ] && echo "TUDO VERDE ✅" || { echo "HOUVE FALHA ❌"; exit 1; }
