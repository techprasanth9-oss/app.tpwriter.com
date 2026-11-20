#!/usr/bin/env bash
# Render every fixture with LibreOffice (headless) and record per-fixture page
# counts (+ per-page text when poppler's pdftotext is available) in
# fixtures/docx/reference.json. PDFs go to fixtures/docx/.render/ (gitignored).
#
# Usage: scripts/fixtures/render_reference.sh [FIXTURE_DIR]
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DIR="${1:-$ROOT/fixtures/docx}"
OUT="$DIR/.render"
SOFFICE="${SOFFICE:-$(command -v soffice || echo /opt/homebrew/bin/soffice)}"

if [[ ! -x "$SOFFICE" ]]; then
  echo "LibreOffice (soffice) not found; set SOFFICE=/path/to/soffice" >&2
  exit 1
fi

mkdir -p "$OUT"
rm -f "$OUT"/*.pdf
# A private profile so a running LibreOffice instance doesn't block us.
PROFILE="$(mktemp -d "${TMPDIR:-/tmp}/tp-fixtures-lo.XXXXXX")"
trap 'rm -rf "$PROFILE"' EXIT

fail=0
for f in "$DIR"/*.docx; do
  name="$(basename "$f" .docx)"
  if ! "$SOFFICE" -env:UserInstallation="file://$PROFILE" --headless --convert-to pdf --outdir "$OUT" "$f" >/dev/null 2>&1 \
     || [[ ! -s "$OUT/$name.pdf" ]]; then
    echo "FAILED to convert $name.docx" >&2
    fail=1
  fi
done

python3 "$ROOT/scripts/fixtures/build_reference.py" "$DIR" "$OUT"
exit $fail
