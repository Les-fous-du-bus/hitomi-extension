#!/usr/bin/env bash
# Triage de tout le catalogue — manga ET light novel.
#
# POURQUOI cette reecriture (2026-09-04) : la version precedente bouclait sur
# `src/manga/*.js` uniquement. Les 19 extensions light novel n'ont donc jamais
# ete triees, et personne ne savait lesquelles marchaient. Cinq d'entre elles
# rendaient une page vide sur le telephone sans que rien ne le signale.
#
# Elle s'appuie desormais sur tools/ext-test.js (harnais universel, verdict de
# bout en bout, contenu mesure en texte reel) au lieu de tools/test-runtime.js,
# qui reste l'outil de mise au point detaillee d'UNE extension (validation de la
# forme des retours contre les modeles Dart).
#
# Verdicts rendus par le harnais :
#   GREEN       tous les chapitres echantillonnes sont lisibles
#   PARTIAL     une partie seulement l'est (selecteur incomplet, ou premier
#               element atypique : preface, annonce, sommaire)
#   EMPTY       on navigue, on ouvre, et il n'y a pas de texte : c'est le cas
#               "fonctionne mal" que l'ancien harnais classait au vert
#   BLOCKED-CF  Cloudflare bloque le HTTP natif ; l'app passe par son navigateur
#               embarque, donc l'extension n'est pas fautive
#   RED         rien ne revient : site mort, domaine change, ou API cassee
#   NO-CHAPTERS la fiche repond mais la liste de chapitres est vide
#
# Usage   : ./tools/triage-all.sh [manga|novel]   (defaut : les deux)
# Sortie  : tools/triage-report.csv + un resume sur la sortie standard

set -u
cd "$(dirname "$0")/.."

SCOPE="${1:-all}"
OUT="tools/triage-report.csv"
TIMEOUT_SECS=180

case "$SCOPE" in
  manga) DIRS=(src/manga) ;;
  novel) DIRS=(src/novel) ;;
  all)   DIRS=(src/manga src/novel) ;;
  *) echo "Usage: $0 [manga|novel]" >&2; exit 1 ;;
esac

echo "ext,space,verdict,readable,list,search,chapters,couv_abs,couv_rel,couv_vide,couv_ok,cloudflare,detail" > "$OUT"

TOTAL=0
run_one() {
  local f="$1" space="$2"
  local ext; ext=$(basename "$f" .js)
  local log="/tmp/triage-${ext}.json"

  if command -v gtimeout >/dev/null 2>&1; then
    gtimeout "${TIMEOUT_SECS}s" node tools/ext-test.js "$f" >"$log" 2>/dev/null
  else
    node tools/ext-test.js "$f" >"$log" 2>/dev/null &
    local pid=$!
    ( sleep "$TIMEOUT_SECS" && kill -9 "$pid" 2>/dev/null ) >/dev/null 2>&1 &
    local watcher=$!
    wait "$pid" 2>/dev/null
    kill "$watcher" 2>/dev/null
  fi

  EXT="$ext" SPACE="$space" python3 - "$log" >> "$OUT" <<'PY'
import json, os, sys
ext, space = os.environ["EXT"], os.environ["SPACE"]
try:
    d = json.load(open(sys.argv[1]))
except Exception:
    print(f'{ext},{space},TIMEOUT,,,,,,,,,,"pas de sortie dans le delai imparti"')
    raise SystemExit
if d.get("error"):
    print(f'{ext},{space},HARNESS-ERROR,,,,,,,,,,"{d.get("error")}: {str(d.get("message",""))[:80]}"')
    raise SystemExit
s = d.get("stages", {})
probes = d.get("chapters_probed", [])
detail = " ".join(f"[{c['i']}]{c.get('text', c.get('pages', '?'))}" for c in probes)
cp = d.get("cover_probes", [])
cov = f'{s.get("cover_abs",0)},{s.get("cover_rel",0)},{s.get("cover_none",0)},{s.get("cover_ok",0)}/{len(cp)}'
codes = "/".join(str(p.get("status")) for p in cp) or "-"
print(f'{ext},{space},{d.get("verdict","?")},{d.get("readable","")},'
      f'{s.get("list",0)},{s.get("search",0)},{s.get("chapters",0)},{cov},'
      f'{"oui" if d.get("cloudflare") else ""},"texte: {detail} | couvertures: {codes}"')
PY
}

for dir in "${DIRS[@]}"; do
  space=$(basename "$dir")
  for f in "$dir"/*.js; do
    [ -e "$f" ] || continue
    TOTAL=$((TOTAL + 1))
    ext=$(basename "$f" .js)
    printf "[%2d] %-24s " "$TOTAL" "$ext"
    run_one "$f" "$space"
    tail -1 "$OUT" | cut -d, -f3,4 | tr ',' ' '
  done
done

echo
echo "=== RESUME DU TRIAGE ==="
printf "  Total        : %s\n" "$TOTAL"
for v in GREEN PARTIAL EMPTY BLOCKED-CF NO-CHAPTERS RED TIMEOUT HARNESS-ERROR; do
  n=$(awk -F, -v v="$v" 'NR>1 && $3==v' "$OUT" | wc -l | tr -d ' ')
  [ "$n" -gt 0 ] && printf "  %-13s: %s\n" "$v" "$n"
done
echo
echo "A reparer en priorite (EMPTY et PARTIAL — on navigue mais on ne lit pas) :"
awk -F, 'NR>1 && ($3=="EMPTY" || $3=="PARTIAL") {printf "  %-24s %s %s\n", $1, $3, $4}' "$OUT"

echo ""
echo "Couvertures a regarder (aucune adresse rendue, ou aucune joignable) :"
awk -F, 'NR>1 && $5+0>0 && ($8+0==0 || $11 ~ /^0\//) {printf "  %-24s liste=%-4s absolues=%-4s relatives=%-3s vides=%-4s joignables=%s\n", $1, $5, $8, $9, $10, $11}' "$OUT"
echo
echo "Rapport : $OUT"
