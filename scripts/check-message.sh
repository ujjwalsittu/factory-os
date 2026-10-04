#!/usr/bin/env bash
# Usage: check-message.sh <file>   or   echo "text" | check-message.sh -
# Fails if the text contains any pattern from .githooks/forbidden-words.txt.
set -euo pipefail
root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"
words="$root/.githooks/forbidden-words.txt"
src="${1:--}"
if [ "$src" = "-" ]; then text="$(cat)"; else text="$(cat "$src")"; fi
# Ignore git's commented lines (commit template / verbose diff).
text="$(printf '%s\n' "$text" | grep -v '^#' || true)"
status=0
while IFS= read -r pat; do
  [[ -z "$pat" || "$pat" == \#* ]] && continue
  if hits="$(printf '%s\n' "$text" | grep -inE "(^|[^[:alnum:]_])(${pat})([^[:alnum:]_]|$)")"; then
    echo "✖ forbidden term /${pat}/ found:" >&2
    printf '    %s\n' "$hits" >&2
    status=1
  fi
done < "$words"
if [ $status -ne 0 ]; then
  echo "Commit messages / PR text must not name AI vendors, models or assistants. See AGENTS.md §Commit rules." >&2
fi
exit $status
