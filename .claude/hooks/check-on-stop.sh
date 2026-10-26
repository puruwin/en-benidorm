#!/usr/bin/env bash
# Hook Stop: ejecuta `npm run check` si hay cambios en archivos tipados.
# Sale con 2 y escribe los errores en stderr para que Claude los corrija antes de terminar.
set -uo pipefail

input="$(cat)"

# Evita bucles: si Claude ya está continuando por este hook, no se vuelve a bloquear.
if printf '%s' "$input" | grep -Eq '"stop_hook_active"[[:space:]]*:[[:space:]]*true'; then
  exit 0
fi

cd "${CLAUDE_PROJECT_DIR:-$(git rev-parse --show-toplevel)}" || exit 0

if ! git status --porcelain --untracked-files=all | grep -Eq '\.(ts|tsx|astro|mjs)$|tsconfig\.json$'; then
  exit 0
fi

output="$(NO_COLOR=1 FORCE_COLOR=0 npm run check 2>&1)"
status=$?

if [ "$status" -ne 0 ]; then
  {
    echo "npm run check ha fallado (código $status). Corrige estos errores antes de terminar:"
    printf '%s\n' "$output" | tail -n 60
  } >&2
  exit 2
fi

exit 0
