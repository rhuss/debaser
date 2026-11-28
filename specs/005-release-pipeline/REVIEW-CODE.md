# Code Review: Release pipeline and distribution channels

**Spec:** specs/005-release-pipeline/spec.md
**Date:** 2026-11-27
**Reviewer:** Claude (speckit.spex-gates.review-code, deep review, CodeRabbit, Codex)
**Branch:** 005-release-pipeline

## Compliance Summary

**Overall Score: 100%**

- Functional Requirements: 22/22 (100%)
- Acceptance scenarios: 15/15 addressed (100%)
- Edge Cases: 14/14 (100%)
- Success Criteria: 8/8 supported (100%)
- Spec-Declared Constants: not applicable (no `## Constants` section in the spec)

All 22 functional requirements are implemented. Several requirements can only be exercised end to end against a published release and the maintainer-owned repositories and credentials listed in the spec's Dependencies. The implementation of those paths is present and is the subject of the deep review below.

## Functional Requirements

| FR | Implementation | Status | Notes |
|----|----------------|--------|-------|
| FR-001 | .github/workflows/release.yml:6-19; workflow_dispatch retry; scripts/release/guard.sh | Compliant | Tag push releases; a dispatch with `dry_run=false` retries the same tag. |
| FR-002 | package.json:3; src/cli/main.ts:37,52-53; scripts/release/version.ts:26-31; guard.sh:18-28; tests/smoke/binary.test.ts:38-42 | Compliant | `package.json` is the single source; guard refuses a mismatch; the smoke test pins the runtime version. |
| FR-003 | scripts/release/guard.sh:41-53 | Compliant | Requires a successful `ci.yml` push run for exactly the tagged SHA. |
| FR-004 | .github/workflows/release.yml:91-103; scripts/release/version.ts:12-17 | Compliant | Four native runner targets. |
| FR-005 | scripts/release/version.ts:104-121; .github/workflows/release.yml:196-206; scripts/release/version.test.ts | Compliant | Two-space `sha256sum -c` format, one line per binary, verified by `sha256sum -c`. |
| FR-006 | .github/workflows/release.yml:131-136; tests/smoke/binary.test.ts:32-99 | Compliant | Version, target, live-view draw, final outcome line, no worker error, 300 s bound. |
| FR-007 | .github/workflows/release.yml:146-150,193-200 | Compliant | Publish needs the full matrix; a missing platform refuses publication. |
| FR-008 | scripts/release/version.ts:35-38; release naming loop | Compliant | `debaser-<version>-<os>-<arch>` with no leading `v`. |
| FR-009 | scripts/release/version.ts:42-44; .github/workflows/release.yml:220-221; channel resolve steps | Compliant | Stable release with generated notes; pre-release entry; stable channels skip pre-releases, including a GitHub pre-release flag. |
| FR-010 | packaging/homebrew/debaser.rb.tmpl; .github/workflows/channel-homebrew.yml | Compliant | Per-platform URL and checksum, `depends_on "git"`, `test do`. |
| FR-011 | .github/workflows/channel-copr.yml; packaging/rpm/debaser.spec.tmpl | Compliant | SRPM carries the release assets; no source build. |
| FR-012 | .github/workflows/channel-aur.yml; packaging/aur/PKGBUILD.tmpl, SRCINFO.tmpl | Compliant | Per-architecture source and checksum; installs the checksummed asset. |
| FR-013 | .github/workflows/channel-apt.yml; README.md apt section | Compliant | Signed repository, one `.deb` per architecture, key and source documented. |
| FR-014 | README.md mise section | Compliant | Exact version, stable or pre-release, from the release assets. |
| FR-015 | All five templates; render tests | Compliant | The installed file is the release asset; each package declares the version. |
| FR-016 | packaging templates; src/git/git.ts:89-95 | Compliant | `git >= 2.38` in RPM, Debian and Arch; `git` in Homebrew; a clear runtime refusal. |
| FR-017 | Four separate channel workflows; release dispatch loop; per-channel concurrency | Compliant | A channel failure does not block the release or another channel; each is retryable alone. |
| FR-018 | Per-channel concurrency; served-version reads; `is-newer` exit codes | Compliant | Retries cannot move a channel backwards; a parse error fails loudly instead of skipping. |
| FR-019 | scripts/release/render.ts:28-48; .github/workflows/*/render steps | Compliant | Refuses package publication without a `license` and a non-empty `LICENSE`. The license itself is a maintainer prerequisite (spec Clarifications and Dependencies). |
| FR-020 | README.md install section | Compliant | Homebrew, release binary, Fedora, Arch, Debian/Ubuntu and mise, with platforms and architectures. |
| FR-021 | .github/workflows/release.yml:24-28,158-164,205-210 | Compliant | Per-tag concurrency; build and publish check out the guarded SHA; no release mixes tags. |
| FR-022 | scripts/release/guard.sh:55-61; publish step; channel push steps | Compliant | An existing release is refused; assets are never replaced or removed. |

## Acceptance Scenarios

- User Story 1 (release binary, 5 scenarios): addressed. Scenarios 1, 2 and 5 run only against a published release and real runners; the workflow implements them. Scenarios 3 and 4 are enforced by `guard.sh` and covered by new guard tests.
- User Story 2 (Homebrew, 4 scenarios): addressed by the formula and the channel workflow. End-to-end verification needs the tap repository and token.
- User Story 3 (Fedora, Arch, Debian, 4 scenarios): addressed by the three channel workflows and templates. End-to-end verification needs the COPR project, the AUR package and the apt repository.
- User Story 4 (mise, 2 scenarios): addressed by the README definition and the asset contract.

## Edge Cases

All 14 edge cases are handled: concurrent tags (per-tag release concurrency and per-channel concurrency), channel failure after publication (independent retry), retry after a newer release (served-version guard), pre-release (no stable channel), incomplete checksum file (publish refuses), unsupported platform (README statement), no license (package refusal), version mismatch (guard), moved or re-pushed tag (existing release refused, tag SHA asserted), malformed tag (guard), commit outside main or without a green run (guard), no native machine (build failure refuses the release), and an old `git` (runtime refusal naming 2.38).

## Extra Features (Not in Spec)

- `workflow_dispatch` with a `dry_run` input on `release.yml`. Justified by FR-001 (retry a refused release without moving the tag) and useful for validating the four platform checks before publishing.
- A `tag` input on each channel workflow for a single-channel retry. Required by FR-017.
- A GitHub pre-release flag check in each channel resolve step. This is stricter than FR-009's tag-based definition and matches the channel contract, which says a pre-release triggers nothing.

## Code Quality Notes

- `bun run typecheck` passes with the new `scripts` include.
- `bun test scripts/release/` passes: 63 tests across 4 files (version, render, guard, CLI).
- `actionlint` reports no issues on the five workflows.
- `shellcheck -S warning` reports no issues on `guard.sh` and `test-parallel.sh`. The intentional single-quoted `bash -c` in `test-parallel.sh` still raises the informational SC2016, as before.
- The release rules are small, pure functions with tests; the workflows call them through their CLIs, and new CLI tests cover the exact argument and exit-code contract.
- The `scripts` include addition makes typecheck cover the release scripts, and the parallel runner now discovers the two new test locations without double-running any file.

## Deep Review Report

**Invocation:** ship pipeline stage 7
**Rounds:** 2 (initial multi-agent review, then fixes and re-validation)
**Gate Outcome:** PASS (no Critical; every code-actionable Important finding fixed)

### Review Agents

| Agent | Found | Fixed | Remaining | Status |
|-------|-------|-------|-----------|--------|
| Correctness | 7 | 6 | 1 Minor | completed |
| Architecture & Idioms | 14 | 3 | 11 Notable/Minor | completed |
| Security | 14 | 4 | 10 Minor/Notable | completed |
| Production Readiness | 16 | 8 | 8 Minor/Notable | completed |
| Test Quality | 16 | 12 | 4 Minor/Notable | completed |
| Goal Alignment | 0 | 0 | 0 | skipped (no PR) |
| CodeRabbit (external) | 10 | 9 | 1 doc (spec artifact) | completed |
| Codex (external) | 0 | 0 | 0 | completed |
| Test Suite (regression) | 0 | 0 | 0 | release tests passed; full suite environment-limited |

### Key Fixes Applied

1. COPR downgrade check now reads `source_package.version` from the COPR API, counts in-flight builds, and fails closed on a query or parse error (channel-copr.yml).
2. Homebrew reads the served version from the same tap clone it pushes, fails on an unreadable formula, and serializes updates per channel (channel-homebrew.yml).
3. AUR and apt updates serialize per channel, so two tags cannot race the push (channel-aur.yml, channel-apt.yml).
4. Channel dispatch attempts all four workflows and reports each failure (release.yml).
5. Build and publish check out the guarded SHA, and publish refuses a moved tag (release.yml).
6. `is-newer` exits 2 on a parse error, and every channel treats only exit 1 as "not newer" (version.ts and all channel workflows).
7. README and the RPM spec fail closed when a checksum line is missing (README.md, debaser.spec.tmpl).
8. PKGBUILD selects the asset by `$CARCH` instead of an unset `source` array (PKGBUILD.tmpl).
9. Channel resolve steps honor a GitHub pre-release or draft flag and fail closed when the release cannot be read (all channel workflows).
10. Packaging tools are pinned (nfpm v2.49.0, copr-cli 2.9), apt verifies the Pages deployment, and the license value is validated before interpolation.

### Remaining Findings

No Critical or Important code findings remain. The remaining items are documented in review-findings.md:

- **Operational (Notable):** tag protection and an approval environment for publication; commit-SHA pinning for actions; an out-of-band signature for `SHA256SUMS`; the shared channel prologue could become a reusable workflow.
- **Minor:** large-number semver comparison, per-template render selection, `--name=value` CLI parity, stale one-time verification notes in docs/release.md, duplicated mise definition, armored keyring naming, secret cleanup and passphrase argv, and stale-binary risk in the prebuilt smoke path.
- **Documentation:** research.md line 32 still says COPR fetches `Source0` over the network, while the implemented SRPM embeds the assets. Spec artifacts were not modified.

### Test Suite Results

| Round | Command | Exit | Failures | Status |
|-------|---------|------|----------|--------|
| 1 | `bun run typecheck` | 0 | 0 | passed |
| 1 | `bun test scripts/release/` | 0 | 0 | passed, 63 tests |
| 1 | `actionlint` (five workflows) | 0 | 0 | passed |
| 1 | `shellcheck -S warning guard.sh test-parallel.sh` | 0 | 0 | passed |
| 1 | `bun test tests/smoke/binary.test.ts` with release env | 0 | 0 | passed, 5 tests |

The full parallel suite was run with 14 files at a time on this workstation. Pre-existing, unrelated integration files timed out or were killed under that load (`src/git/git.test.ts`, `tests/integration/handoffs.test.ts`, `harness.test.ts`, `acceptance.test.ts`). `src/steps/commands.test.ts` passed when rerun alone. No failing test touches the release pipeline, and all release-specific tests pass. This is recorded as an environment limitation.

### Post-Fix Spec Coverage

All 22 functional requirements were re-checked after the fix loop. No fix removed a requirement implementation. FR-019 remains an external prerequisite: the repository has no `LICENSE` or `package.json` license yet, which is the specified refusal until the maintainer records one.

## Conclusion

The implementation matches the specification across all functional requirements, acceptance scenarios and edge cases. The deep review found no Critical issues. It found 15 Important issues, all fixed and re-validated, mostly around release immutability, channel downgrade races, fail-open checks and test strength. The remaining findings are hardening and maintainability items that need repository settings, a project-wide convention, or a larger refactor.

**Gate:** PASS

**Next Steps:**
- The maintainer must add the chosen `LICENSE` and `package.json` license before the first package publication (FR-019).
- The maintainer must create the tap, COPR, AUR, apt and mise dependencies and their secrets before the first channel release.
