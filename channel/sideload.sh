#!/usr/bin/env bash
# Package and optionally sideload the Roku channel.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")" && pwd)"
OUT="${ROOT}/roku-substack.zip"

# Load ROKU_* from backend/.env (or channel/.env) if present.
for env_file in "${ROOT}/../backend/.env" "${ROOT}/.env"; do
  if [[ -f "$env_file" ]]; then
    set -a
    # shellcheck disable=SC1090
    source "$env_file"
    set +a
    break
  fi
done

rm -f "$OUT"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$STAGE"
cp "$ROOT/manifest" "$STAGE/"
cp -R "$ROOT/source" "$ROOT/components" "$ROOT/images" "$STAGE/"

if [[ -n "${PUBLIC_BASE_URL:-}" ]]; then
  python3 - "$STAGE/components/MainScene.xml" "${PUBLIC_BASE_URL%/}" <<'PY'
import re, sys
from pathlib import Path
path, url = Path(sys.argv[1]), sys.argv[2]
text = path.read_text()
updated, n = re.subn(
    r'(<field id="apiBaseUrl" type="string" value=")[^"]*(")',
    rf"\1{url}\2",
    text,
    count=1,
)
if n != 1:
    raise SystemExit("Could not stamp apiBaseUrl into MainScene.xml")
path.write_text(updated)
print(f"apiBaseUrl={url}")
PY
fi

(
  cd "$STAGE"
  zip -9 -r "$OUT" manifest source components images \
    -x "*.DS_Store" -x "*/.git/*"
)

echo "Built $OUT"

if [[ "${1:-}" == "install" ]]; then
  if [[ -z "${ROKU_IP:-}" ]]; then
    echo "Set ROKU_IP in backend/.env (or export it)" >&2
    exit 1
  fi
  if [[ -z "${ROKU_PASS:-}" ]]; then
    echo "Set ROKU_PASS in backend/.env (or export it)" >&2
    echo "This is the password you set when enabling developer mode — not your Roku account password." >&2
    exit 1
  fi
  ROKU_USER="${ROKU_USER:-rokudev}"

  # Roku's web installer requires HTTP Digest auth (basic auth silently fails).
  response="$(
    curl -sS --digest --user "${ROKU_USER}:${ROKU_PASS}" \
      --form "mysubmit=Install" \
      --form "archive=@${OUT};type=application/zip" \
      "http://${ROKU_IP}/plugin_install"
  )"

  echo "$response" | tr '\n' ' ' | sed 's/<[^>]*>//g' | sed 's/  */ /g' | fold -s -w 100
  echo

  if echo "$response" | grep -qiE 'Failed to install|Unauthorized|Invalid password|Compilation Failed|Install Failure'; then
    echo "Sideload failed. Check ROKU_IP / ROKU_PASS (developer-mode password)." >&2
    exit 1
  fi
  if ! echo "$response" | grep -qiE 'Install Success|Replace Success|Successful'; then
    echo "Sideload response did not look successful. Open http://${ROKU_IP} and check developer mode." >&2
    exit 1
  fi

  echo "Sideloaded to ${ROKU_IP}"
fi
