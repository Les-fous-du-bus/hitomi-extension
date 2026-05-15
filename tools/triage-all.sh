#!/usr/bin/env bash
# Phase B v2.0.13 — Triage runner.
# Runs tools/test-runtime.js against every manga extension and outputs a
# CSV summary classifying each ext as GREEN / YELLOW / RED.
#
# GREEN  = all 6 methods PASS (or 5/6 with only soft warnings)
# YELLOW = 1-2 methods FAIL (fixable: shape, selector, key)
# RED    = >=3 methods FAIL OR network timeout (site dead / CF strict / API hard)
#
# Usage: ./tools/triage-all.sh
# Output: tools/triage-report.csv + summary on stdout

set -u
cd "$(dirname "$0")/.."

OUT="tools/triage-report.csv"
echo "ext,status,pass,fail,fatal,error_summary" > "$OUT"

TIMEOUT_SECS=60
PASS_COUNT=0
TOTAL=0

for f in src/manga/*.js; do
  ext=$(basename "$f" .js)
  TOTAL=$((TOTAL+1))
  printf "[%2d] %-22s " "$TOTAL" "$ext"

  LOG="/tmp/triage-${ext}.log"
  # gtimeout if available, otherwise rely on harness internal timeouts
  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${TIMEOUT_SECS}s" node tools/test-runtime.js "$ext" >"$LOG" 2>&1
    RC=$?
  else
    node tools/test-runtime.js "$ext" >"$LOG" 2>&1 &
    PID=$!
    ( sleep "$TIMEOUT_SECS" && kill -9 "$PID" 2>/dev/null ) &
    WATCHER=$!
    wait "$PID" 2>/dev/null
    RC=$?
    kill "$WATCHER" 2>/dev/null
  fi

  PASS=$(grep -c "PASS" "$LOG" || true)
  FAIL=$(grep -c "FAIL" "$LOG" || true)
  HARNESS_LINE=$(grep -oE '[0-9]+/[0-9]+ PASS' "$LOG" | head -1)

  if [ "$RC" -eq 124 ] || [ "$RC" -eq 137 ]; then
    STATUS="RED"
    FATAL="timeout-${TIMEOUT_SECS}s"
    ERR_SUMMARY="network timeout or hang"
  elif [ "$RC" -eq 2 ]; then
    STATUS="RED"
    FATAL="harness-error"
    ERR_SUMMARY=$(grep -oE '\[ERR\][^|]*' "$LOG" | head -1 | tr -d ',')
  elif [ -z "$HARNESS_LINE" ]; then
    STATUS="RED"
    FATAL="no-summary"
    ERR_SUMMARY=$(grep -oE '\[FATAL\][^|]*|\[ERR\][^|]*' "$LOG" | head -1 | tr -d ',')
  else
    # Parse "N/M PASS"
    NPASS=$(echo "$HARNESS_LINE" | cut -d/ -f1)
    NTOTAL=$(echo "$HARNESS_LINE" | awk '{print $1}' | cut -d/ -f2)
    NFAIL=$((NTOTAL - NPASS))
    FATAL=""
    if [ "$NFAIL" -eq 0 ]; then
      STATUS="GREEN"
    elif [ "$NFAIL" -le 2 ]; then
      STATUS="YELLOW"
    else
      STATUS="RED"
    fi
    ERR_SUMMARY=$(grep -oE '\-> [^|]+' "$LOG" | grep -i "fail\|error\|invalid" | head -1 | tr -d ',' | cut -c1-120)
  fi

  echo "$ext,$STATUS,${NPASS:-0},${NFAIL:-0},$FATAL,\"$ERR_SUMMARY\"" >> "$OUT"
  echo "$STATUS ${HARNESS_LINE:-(no summary)} ${FATAL}"

  if [ "$STATUS" = "GREEN" ]; then
    PASS_COUNT=$((PASS_COUNT+1))
  fi
done

echo
echo "=== TRIAGE SUMMARY ==="
echo "Total ext : $TOTAL"
echo "GREEN     : $(grep -c ',GREEN,' "$OUT" || true)"
echo "YELLOW    : $(grep -c ',YELLOW,' "$OUT" || true)"
echo "RED       : $(grep -c ',RED,' "$OUT" || true)"
echo
echo "Report: $OUT"
