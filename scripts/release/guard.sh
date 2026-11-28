#!/usr/bin/env bash
# Refuses a release that must not happen. Every check the spec puts before the
# build lives here, so a release is refused for the same reasons locally and in
# the workflow. Env: TAG, SHA and GH_TOKEN. Exit 0 only when the tag is well
# formed, matches package.json, sits on origin/main, has a successful ci.yml
# push run for exactly that commit, and no release exists for the version.
set -uo pipefail

fail=0
refuse() { echo "guard: $*" >&2; fail=1; }

: "${TAG:?guard: TAG is required}"
: "${SHA:?guard: SHA is required}"
: "${GH_TOKEN:?guard: GH_TOKEN is required}"

here=$(cd "$(dirname "$0")" && pwd)

# A malformed tag or a version mismatch cannot be checked any further.
version=$(bun "$here/version.ts" parse-tag "$TAG" 2>/dev/null) ||
  { echo "guard: tag '$TAG' is not v<semantic-version>" >&2; exit 1; }

pkg_version=$(bun -e 'import { readFileSync } from "node:fs"; process.stdout.write(JSON.parse(readFileSync("package.json", "utf8")).version)') ||
  { echo "guard: cannot read package.json" >&2; exit 1; }

# The comparison is the tested matcher, so the guard and its tests cannot drift.
if ! matches=$(bun "$here/version.ts" matches-tag "$TAG" "$pkg_version" 2>/dev/null); then
  matches=false
fi
if [ "$matches" != "true" ]; then
  echo "guard: tag '$TAG' carries $version but package.json declares $pkg_version" >&2
  exit 1
fi

# The release must be built from the default branch, not from a side branch.
# A shallow checkout has no origin/main; the guard fails closed with a clear line.
if ! git fetch --no-tags --quiet origin +refs/heads/main:refs/remotes/origin/main 2>/dev/null; then
  refuse "cannot fetch origin/main"
fi
if ! git rev-parse --verify --quiet refs/remotes/origin/main >/dev/null; then
  refuse "origin/main is missing; the guard needs a full-history checkout (fetch-depth: 0)"
elif ! git merge-base --is-ancestor "$SHA" refs/remotes/origin/main 2>/dev/null; then
  refuse "commit $SHA is not on origin/main"
fi

# The tag has no CI result of its own, so the commit's green push run is reused.
if ! runs=$(gh run list --workflow ci.yml --commit "$SHA" --limit 100 \
  --json conclusion,headSha,event \
  --jq "[.[] | select(.headSha == \"$SHA\" and .event == \"push\" and .conclusion == \"success\")] | length" 2>/dev/null); then
  refuse "cannot read ci.yml runs for commit $SHA"
elif ! [[ "${runs:-}" =~ ^[0-9]+$ ]]; then
  refuse "cannot read ci.yml runs for commit $SHA"
elif [ "$runs" -eq 0 ]; then
  refuse "no successful push run of ci.yml for commit $SHA"
fi

# Published assets are immutable, so an existing release is never replaced.
# Only a definite 404 means "no release"; any other API failure is refused
# rather than read as "nothing exists" (fail closed).
if output=$(gh api "repos/{owner}/{repo}/releases/tags/v$version" 2>&1 >/dev/null); then
  refuse "release v$version already exists; published assets are not replaced"
else
  case "$output" in
    *"HTTP 404"*) ;;
    *) refuse "cannot check for an existing release: $output" ;;
  esac
fi

exit "$fail"
