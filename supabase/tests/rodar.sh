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
PSQL=(psql "$SUPABASE_DB_URL" -qX)

falhou=0

echo "── Travas de servidor ───────────────────────────────────────────────────"
"${PSQL[@]}" -f supabase/tests/02_travas.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

echo
echo "── Automações ───────────────────────────────────────────────────────────"
"${PSQL[@]}" -f supabase/tests/03_automacoes.sql 2>&1 | sed 's/^psql.*NOTICE:  //;s/^psql.*WARNING:  //' || falhou=1

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
