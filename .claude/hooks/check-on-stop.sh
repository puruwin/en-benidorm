#!/usr/bin/env bash
# Hook Stop: ejecuta `npm run check` si hay cambios en archivos tipados y, si cambian
# src/ o astro.config.mjs, `npm run build` + `npm run seo:audit` contra la línea base.
# Sale con 2 y escribe los errores en stderr para que Claude los corrija antes de terminar.
set -uo pipefail

input="$(cat)"

# Evita bucles: si Claude ya está continuando por este hook, no se vuelve a bloquear.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

changed="$(git status --porcelain --untracked-files=all)"

fail() {
  {
    echo "$1"
    printf '%s\n' "$2" | tail -n 60
  } >&2
  exit 2
}

if printf '%s\n' "$changed" | grep -Eq '\.(ts|tsx|astro|mjs)$|tsconfig\.json$'; then
  output="$(NO_COLOR=1 FORCE_COLOR=0 npm run check 2>&1)"
  status=$?
  [ "$status" -ne 0 ] && fail "npm run check ha fallado (código $status). Corrige estos errores antes de terminar:" "$output"
fi

# Solo bloquea errores SEO nuevos: los conocidos están en scripts/seo/baseline.json.
if printf '%s\n' "$changed" | grep -Eq '^.. (src/|astro\.config\.mjs$)'; then
  output="$(NO_COLOR=1 FORCE_COLOR=0 npm run build 2>&1)"
  status=$?
  [ "$status" -ne 0 ] && fail "npm run build ha fallado (código $status). Corrige estos errores antes de terminar:" "$output"

  output="$(npm run seo:audit -- --baseline scripts/seo/baseline.json 2>&1)"
  status=$?
  [ "$status" -ne 0 ] && fail "npm run seo:audit ha encontrado errores nuevos respecto a scripts/seo/baseline.json (código $status). Corrígelos antes de terminar:" "$(printf '%s\n' "$output" | grep -v 'en línea base')"
fi

exit 0
