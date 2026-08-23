#!/usr/bin/env bash
# Prova que dois atendentes nunca pegam o mesmo contato.
#
# Se este teste falhar, duas pessoas ligam para o mesmo eleitor — o cenário que
# docs/02-CONSTRUCAO-TECNICA.md §6 chama de "pode virar denúncia".
#
# Uso: PGPASSWORD=... PGHOST=... ./supabase/tests/concorrencia.sh
set -uo pipefail

# Aceita PSQL_URL para o runner funcionar sem exportar PGHOST/PGPASSWORD.
CONN=("${PSQL_URL:-}")
[ -z "${CONN[0]}" ] && CONN=()

PARES=$(psql "${CONN[@]}" -qtAX -c "
  select u.id || ' ' || c.id
    from public.usuarios u
    join public.chips c on c.atendente_id = u.id
   where c.rotulo like 'Chip Teste %'
   order by c.rotulo;")

claim() { # $1=uid $2=chip $3=arquivo de saida
  psql "${CONN[@]}" -qtAX -o "$3" -c "
    begin;
    set local request.jwt.claims = '{\"sub\":\"$1\",\"role\":\"authenticated\"}';
    select coalesce(public.pegar_proximo_contato('$2')->'contato'->>'id',
                    'FALHOU:' || (public.pegar_proximo_contato('$2')->>'motivo'));
    commit;" >/dev/null 2>&1
}

OUT=$(mktemp -d)
echo "── Teste 1: lock exclusivo (sessão A segura a transação aberta) ─────────"

LINHA_A=$(echo "$PARES" | sed -n 1p); UID_A=${LINHA_A% *}; CHIP_A=${LINHA_A#* }
LINHA_B=$(echo "$PARES" | sed -n 2p); UID_B=${LINHA_B% *}; CHIP_B=${LINHA_B#* }

# A pega um contato e SEGURA a transação aberta por 4s, sem commitar.
psql "${CONN[@]}" -qtAX -o "$OUT/a" -c "
  begin;
  set local request.jwt.claims = '{\"sub\":\"$UID_A\",\"role\":\"authenticated\"}';
  select public.pegar_proximo_contato('$CHIP_A')->'contato'->>'id';
  select pg_sleep(4);
  commit;" >/dev/null 2>&1 &
PID_A=$!

sleep 1.5
# B pede o próximo enquanto A ainda não commitou.
claim "$UID_B" "$CHIP_B" "$OUT/b"
wait $PID_A

A=$(head -1 "$OUT/a"); B=$(head -1 "$OUT/b")
echo "  A pegou: $A"
echo "  B pegou: $B"
if [ -z "$A" ] || [ -z "$B" ] || [ "$A" = "$B" ]; then
  echo "  ❌ FALHOU: os dois pegaram o mesmo contato (ou nenhum)"; FALHAS=1
else
  echo "  ✅ contatos diferentes com a transação de A ainda aberta"
fi

echo
echo "── Teste 2: 8 atendentes disparando ao mesmo tempo ──────────────────────"
i=0
while read -r linha; do
  i=$((i+1)); [ "$i" -le 2 ] && continue
  u=${linha% *}; c=${linha#* }
  claim "$u" "$c" "$OUT/p$i" &
done <<< "$PARES"
wait

RESULTADOS=$(cat "$OUT"/p* 2>/dev/null | grep -v '^$')
TOTAL=$(echo "$RESULTADOS" | wc -l | tr -d ' ')
UNICOS=$(echo "$RESULTADOS" | sort -u | wc -l | tr -d ' ')
ERROS=$(echo "$RESULTADOS" | grep -c '^FALHOU' || true)

echo "  claims: $TOTAL · distintos: $UNICOS · recusados: $ERROS"
if [ "$TOTAL" != "$UNICOS" ]; then
  echo "  ❌ FALHOU: houve contato entregue duas vezes"; FALHAS=1
else
  echo "  ✅ nenhum contato entregue duas vezes"
fi

echo
echo "── Teste 3: ordem da fila (quente antes de frio) ────────────────────────"
# Sequencial de propósito. Sob concorrência não dá para aferir a ORDEM de
# entrega: claimed_at é o horário de início da transação, e uma transação que
# começou antes pode adquirir o lock depois. O produto entrega certo, mas a
# medição ficaria inconclusiva. Aqui claimamos um de cada vez, com chips
# diferentes (o intervalo mínimo impede o mesmo chip de pegar dois seguidos), e
# lemos a origem direto da resposta da função.
psql "${CONN[@]}" -qtAX -c "
  update public.contatos
     set status='na_fila', atendente_id=null, chip_id=null, claimed_at=null, claim_expira_em=null
   where nome like 'Contato Teste %';" >/dev/null

ORIGENS=""
i=0
while read -r linha; do
  i=$((i+1)); [ "$i" -gt 4 ] && break
  u=${linha% *}; c=${linha#* }
  o=$(psql "${CONN[@]}" -qtAX -c "
    begin;
    set local request.jwt.claims = '{\"sub\":\"$u\",\"role\":\"authenticated\"}';
    select public.pegar_proximo_contato('$c')->'contato'->>'origem';
    commit;")
  ORIGENS="$ORIGENS$o,"
done <<< "$PARES"

echo "  4 primeiras entregas: ${ORIGENS%,}"
if [ "${ORIGENS%,}" = "site,site,site,lista_fria" ]; then
  echo "  ✅ os 3 quentes saíram primeiro, e só então a fila fria"
else
  echo "  ❌ FALHOU: a fila fria foi atendida antes da quente"; FALHAS=1
fi

echo "── Teste 4: retomada (recarregar a página não pula contato) ─────────────"
PRIMEIRO=$(psql "${CONN[@]}" -qtAX -c "
  begin;
  set local request.jwt.claims = '{\"sub\":\"$UID_B\",\"role\":\"authenticated\"}';
  select public.pegar_proximo_contato('$CHIP_B')->'contato'->>'id';
  commit;")
SEGUNDO=$(psql "${CONN[@]}" -qtAX -c "
  begin;
  set local request.jwt.claims = '{\"sub\":\"$UID_B\",\"role\":\"authenticated\"}';
  select public.pegar_proximo_contato('$CHIP_B')->'contato'->>'id';
  commit;")
echo "  1ª chamada: $PRIMEIRO"
echo "  2ª chamada: $SEGUNDO"
if [ -n "$PRIMEIRO" ] && [ "$PRIMEIRO" = "$SEGUNDO" ]; then
  echo "  ✅ devolveu o mesmo contato, não consumiu outro"
else
  echo "  ❌ FALHOU: a segunda chamada pulou para outro contato"; FALHAS=1
fi

rm -rf "$OUT"
echo
if [ "${FALHAS:-0}" = "1" ]; then echo "RESULTADO: ❌ FALHOU"; exit 1; fi
echo "RESULTADO: ✅ tudo passou"
