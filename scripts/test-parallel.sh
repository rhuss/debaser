#!/usr/bin/env bash
# Runs every test file in its own `bun test` process, several at a time.
#
# The integration tests spend most of their time waiting on git and step
# processes, one test after another, so a single `bun test` leaves the CPU idle.
# Each test builds its own temporary repositories, so separate processes cannot
# interfere. Files with the most tests start first, so the longest one doesn't
# start last.
#
# Usage: scripts/test-parallel.sh [bun test options...]
# DEBASER_TEST_JOBS sets how many files run at once (default: the CPU count).
set -uo pipefail

cd "$(dirname "$0")/.." || exit 1
jobs="${DEBASER_TEST_JOBS:-$(getconf _NPROCESSORS_ONLN 2>/dev/null || echo 4)}"
logs="$(mktemp -d "${TMPDIR:-/tmp}/debaser-tests.XXXXXX")" || exit 1
[ -n "$logs" ] || exit 1
trap 'rm -rf "$logs"' EXIT

# Test files, the ones with the most tests first.
files=()
while IFS= read -r line; do files+=("${line#* }"); done < <(
  find src tests scripts -name '*.test.ts' -print | while IFS= read -r f; do
    printf '%s %s\n' "$(grep -cE '^\s*test(\.\w+)?\(' "$f")" "$f"
  done | sort -rn
)
[ "${#files[@]}" -gt 0 ] || { echo "no test files found" >&2; exit 1; }

echo "running ${#files[@]} test files, $jobs at a time"
start=$(date +%s)
export logs
# One line per file as it finishes; the full output stays in its log.
printf '%s\n' "${files[@]}" | xargs -P "$jobs" -I{} bash -c '
  f="$1"; shift
  log="$logs/$(printf "%s" "$f" | tr "/" "_").log"
  t=$(date +%s)
  if bun test "./$f" "$@" >"$log" 2>&1; then r=ok; else r=FAIL; touch "$log.failed"; fi
  summary=$(grep -E "^ *[0-9]+ (pass|fail)$" "$log" | tr -s " " | tr "\n" " ")
  printf "%-4s %4ss  %s  (%s)\n" "$r" "$(( $(date +%s) - t ))" "$f" "${summary% }"
' _ {} "$@" || { echo "test runner failed to execute every file" >&2; exit 1; }

failed=$(find "$logs" -name '*.failed' | wc -l | tr -d ' ')
echo "done in $(( $(date +%s) - start ))s: ${#files[@]} files, $failed failed"
if [ "$failed" -gt 0 ]; then
  for marker in "$logs"/*.failed; do
    echo
    echo "===== ${marker%.failed} ====="
    cat "${marker%.failed}"
  done
  exit 1
fi
