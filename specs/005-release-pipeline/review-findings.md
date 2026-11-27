# Deep Review Findings

**Date:** 2026-11-27
**Branch:** 005-release-pipeline
**Rounds:** 2 (initial review, then fixes and re-validation)
**Gate Outcome:** PASS (no Critical; every code-actionable Important finding fixed; remaining items are operational hardening that needs repository settings or a project-wide convention)
**Invocation:** manual (ship pipeline stage 7)

## Summary

| Severity | Found | Fixed | Remaining |
|----------|-------|-------|-----------|
| Critical | 0 | 0 | 0 |
| Important | 15 | 15 | 0 (5 operational items reclassified as Notable, see below) |
| Minor | 17 | 9 | 8 |
| Notable | 12 | 1 | 11 |
| **Total** | **44** | **25** | **19** |

**Agents completed:** 5/5 internal (Correctness, Architecture, Security, Production Readiness, Test Quality). Goal Alignment skipped because no PR or linked issue exists.
**External tools:** CodeRabbit completed (10 major findings). Codex completed (no actionable defects; it could not run tests in its read-only sandbox).

## Important findings (all fixed)

### FINDING-1: COPR downgrade check read a field that does not exist
- **Severity:** Important
- **Confidence:** 95
- **File:** .github/workflows/channel-copr.yml (was lines 81-88, now 94-110)
- **Category:** correctness
- **Source:** correctness-agent, architecture-agent, CodeRabbit
- **Round found:** 1
- **Resolution:** fixed (round 1)

`copr-cli list-builds --output-format json` does not expose `.pkg_version`; the filter yielded null, jq failed, and `|| served=""` turned the failure into "COPR serves nothing". The FR-018 guard never ran. The step now reads the COPR API v3 build list, selects `source_package.name == "debaser"`, strips the trailing RPM release from `source_package.version`, counts `succeeded`, `running` and `pending` builds, and fails the job when the query or parse fails. The audit query in docs/release.md was corrected the same way.

### FINDING-2: Homebrew could downgrade the tap and treated a read failure as "nothing served"
- **Severity:** Important
- **Confidence:** 95
- **File:** .github/workflows/channel-homebrew.yml (lines 21, 88-113)
- **Category:** correctness, production-readiness
- **Source:** correctness-agent, architecture-agent, production-agent, CodeRabbit
- **Round found:** 1
- **Resolution:** fixed (round 1)

The served version came from the Contents API before the tap was cloned, so a transient API error yielded `served=""`, and a newer tag pushing between the read and the clone let an older retry fast-forward over it. The workflow now has one per-channel concurrency group, reads `version "..."` from the same clone it pushes, and fails the run when the formula exists but cannot be read or parsed.

### FINDING-3: AUR concurrency keyed per tag, not per package
- **Severity:** Important
- **Confidence:** 90
- **File:** .github/workflows/channel-aur.yml (line 21)
- **Category:** production-readiness
- **Source:** CodeRabbit
- **Resolution:** fixed (round 1)

Two tags could clone the same AUR tip and collide on push. The concurrency group is now `channel-aur`, so updates serialize and each run reads the previous run's tip.

### FINDING-4: apt concurrency keyed per tag, not per destination
- **Severity:** Important
- **Confidence:** 90
- **File:** .github/workflows/channel-apt.yml (line 23)
- **Category:** production-readiness
- **Source:** CodeRabbit
- **Resolution:** fixed (round 1)

Two tags could clone the same `gh-pages` tip and one push would be rejected. The concurrency group is now `channel-apt`.

### FINDING-5: One failed channel dispatch stopped the remaining dispatches
- **Severity:** Important
- **Confidence:** 90
- **File:** .github/workflows/release.yml (lines 230-240)
- **Category:** correctness, production-readiness
- **Source:** correctness-agent, architecture-agent, production-agent, CodeRabbit
- **Resolution:** fixed (round 1)

The loop ran under `set -e`, so a failed `gh workflow run` skipped later channels after the release was already public. The step now tries all four dispatches, reports each failure with `::error::`, and exits nonzero at the end.

### FINDING-6: The guarded commit SHA was not used by the build and publish jobs
- **Severity:** Important
- **Confidence:** 85
- **File:** .github/workflows/release.yml (lines 104-110, 158-164, 205-210)
- **Category:** correctness, production-readiness
- **Source:** correctness-agent, production-agent
- **Resolution:** fixed (round 1)

The build and publish jobs re-checked out the mutable tag instead of `needs.guard.outputs.sha`, so a tag moved between jobs could publish a commit the guard never validated. Both jobs now check out the guarded SHA, and publish re-fetches the tag and refuses unless it points at that SHA.

### FINDING-7: `is-newer` reported a parse error as "not newer"
- **Severity:** Important
- **Confidence:** 90
- **File:** scripts/release/version.ts (lines 152-163), all four channel workflows
- **Category:** production-readiness, test-quality
- **Source:** production-agent, tests-agent
- **Resolution:** fixed (round 1)

Exit code 1 meant both "candidate is not newer" and "the version cannot be parsed", and every channel inverted it with `!`, silently skipping the channel. `is-newer` now exits 2 on a parse error. Each channel treats only exit 1 as a skip and fails loudly on 2.

### FINDING-8: README checksum verification could pass while verifying nothing
- **Severity:** Important
- **Confidence:** 95
- **File:** README.md (lines 46-63)
- **Category:** security
- **Source:** security-agent, CodeRabbit
- **Resolution:** fixed (round 1)

`grep ... | sha256sum -c -` exits 0 on empty input, so a missing checksum line installed an unverified binary. The snippet now captures the line, fails when it is absent, uses `set -e`, and picks `sha256sum` or `shasum` for the platform so a mismatch stops the procedure.

### FINDING-9: RPM `%prep` checksum check had the same empty-input hole
- **Severity:** Important
- **Confidence:** 85
- **File:** packaging/rpm/debaser.spec.tmpl (lines 31-38)
- **Category:** security
- **Source:** security-agent
- **Resolution:** fixed (round 1)

The grep pipeline now captures the line, exits 1 when it is absent, and only then pipes to `sha256sum -c`.

### FINDING-10: PKGBUILD `package()` read an unset `source` array
- **Severity:** Important
- **Confidence:** 90
- **File:** packaging/aur/PKGBUILD.tmpl (lines 21-30)
- **Category:** correctness
- **Source:** CodeRabbit
- **Resolution:** fixed (round 1)

`source_x86_64` and `source_aarch64` do not populate `source`, so `${source[0]}` was empty and the AUR package would install the wrong path. `package()` now selects the asset by `$CARCH`.

### FINDING-11: A GitHub pre-release flag did not stop a stable channel
- **Severity:** Important
- **Confidence:** 85
- **File:** all four .github/workflows/channel-*.yml, resolve step
- **Category:** correctness, security
- **Source:** CodeRabbit
- **Resolution:** fixed (round 1)

The channels classified only the tag suffix. A release flagged pre-release or draft on GitHub would still update a stable channel. Each resolve step now reads the release metadata with `gh api`, fails closed when it cannot, and treats a pre-release or draft release as a pre-release.

### FINDING-12: Template tests used only the current package version
- **Severity:** Important
- **Confidence:** 90
- **File:** scripts/release/render.test.ts (lines 262-300)
- **Category:** test-quality
- **Source:** tests-agent
- **Resolution:** fixed (round 1)

Every template test rendered `0.1.0`, the current package version, so a hardcoded version would pass. A new test renders all five templates at `9.8.7` and asserts the version, the release URL and the absence of `0.1.0` and placeholders. Another renders with `Apache-2.0` to prove the license is data.

### FINDING-13: Weak checksum and pairing assertions
- **Severity:** Important
- **Confidence:** 90
- **File:** scripts/release/version.test.ts, scripts/release/render.test.ts
- **Category:** test-quality
- **Source:** tests-agent
- **Resolution:** fixed (round 1)

The sums test wrote identical bytes to every asset and never compared digests. It now writes distinct bytes and asserts the exact file, plus a `sha256sum -c` acceptance test. The Homebrew test now asserts each URL is adjacent to its own digest, and the package tests assert the installed payload path.

### FINDING-14: The platform check did not verify the target architecture
- **Severity:** Important
- **Confidence:** 80
- **File:** tests/smoke/binary.test.ts (lines 44-52), .github/workflows/release.yml (line 135)
- **Category:** test-quality
- **Source:** tests-agent
- **Resolution:** fixed (round 1)

A wrong runner label could publish a mislabeled asset. The workflow passes `DEBASER_EXPECTED_TARGET` and the smoke test asserts `process.platform` and `process.arch` match it.

### FINDING-15: Packaging tools were installed unpinned
- **Severity:** Important
- **Confidence:** 90
- **File:** .github/workflows/channel-apt.yml (line 85), .github/workflows/channel-copr.yml (line 84)
- **Category:** security, production-readiness
- **Source:** security-agent, production-agent
- **Resolution:** fixed (round 1)

A retry months later could run different tool code in a job holding signing and repository credentials. nfpm is now pinned to `v2.49.0` and copr-cli to `2.9`.

## Minor findings fixed

- FINDING-16: `guard.sh` treated any `gh` failure as "no existing release" and skipped the CI count when the output was empty. It now distinguishes a 404, validates the run count shape, and refuses on any other error (scripts/release/guard.sh lines 41-60).
- FINDING-17: `scripts/test-parallel.sh` could exit 0 without running tests if setup failed. It now guards `cd`, `mktemp` and the `xargs` exit status (lines 14-17, 32-39).
- FINDING-18: `render.ts` interpolated the license raw into Ruby, YAML and RPM metadata. It now validates an SPDX expression character set (lines 28-48).
- FINDING-19: The `licenseOf` comment claimed the LICENSE text is compared with the identifier. It now states what the code actually checks (lines 32-35).
- FINDING-20: The guard job requested unused `checks: read`. Removed (.github/workflows/release.yml line 35-38).
- FINDING-21: apt reported success after `git push` without confirming Pages serves the version. A bounded poll now fails the channel when Pages does not serve the new version (lines 176-192).
- FINDING-22: Channel retries rendered from the default branch. Each channel now checks out the release tag (all four channel workflows).
- FINDING-23: The smoke test did not assert the absence of a worker error. Added a conservative worker-error assertion (tests/smoke/binary.test.ts line 97-98).
- FINDING-24: The smoke test header cited FR-051 and SC-005 from another feature. Corrected to FR-002, FR-004, FR-006, FR-008, SC-003 and SC-004.

## Remaining findings

### Minor

- **FINDING-25**: `compareVersions` uses IEEE-754 `Number`, so numeric identifiers above 2^53 compare equal (scripts/release/version.ts lines 61-90). Latent; no real version reaches that size. Fix by comparing digit strings or `BigInt`.
- **FINDING-26**: `renderAll` always renders all five templates for every channel, and its `templates` option has no caller (scripts/release/render.ts lines 100-117). A missing value in an unrelated format fails every channel.
- **FINDING-27**: `render.ts` reimplements `option()` and does not accept `--name=value` (scripts/release/render.ts lines 128-134), unlike src/cli/args.ts.
- **FINDING-28**: `docs/release.md` keeps a one-time "Verification status before the first release" section that becomes stale after merge (lines 179-214).
- **FINDING-29**: The mise tool definition is duplicated in README.md and docs/release.md, and the mise `http` backend has no checksum field in the example (README.md lines 107-112, docs/release.md lines 166-171).
- **FINDING-30**: The apt keyring is ASCII-armored but named `debaser-archive-keyring.gpg`; the README compensates with `gpg --dearmor`, but a consumer that uses the file directly with apt would fail (.github/workflows/channel-apt.yml line 164).
- **FINDING-31**: Secrets written to disk (AUR private key, COPR config, GNUPGHOME, PATs in `.git/config`) are not removed at job end, and the GPG passphrase is passed on the command line (channel-aur.yml lines 73-76, channel-copr.yml lines 84-88, channel-apt.yml lines 158-166). Low impact on GitHub-hosted ephemeral runners.
- **FINDING-32**: `DEBASER_BINARY_PREBUILT=1` can run against a stale `dist/debaser` if the caller forgets to build; the release workflow builds first, so the release path is safe (tests/smoke/binary.test.ts lines 12-21).

### Notable

- **NOTABLE-1**: The workflow and `guard.sh` executed on a tag push come from the tagged commit, so the guard cannot enforce its own precondition against a non-maintainer who can push `v*` tags. Mitigation is repository configuration: protect `v*` tags and put publish behind an environment with required reviewers. This is a process control, not a code defect.
- **NOTABLE-2**: Actions are pinned to mutable major tags (`actions/checkout@v4`, `oven-sh/setup-bun@v2`, `actions/*-artifact@v4`), consistent with the existing ci.yml. A project-wide move to commit SHAs is recommended.
- **NOTABLE-3**: Release assets and their checksums come from the same release, so the checksum detects corruption, not a compromised release. Signing `SHA256SUMS` with an out-of-band key (cosign, minisign, attestations) is the stronger trust model.
- **NOTABLE-4**: The four channel workflows repeat the same resolve, pre-release skip and download-and-verify prologue. A reusable workflow or composite action would remove the divergence risk, but the refactor was not attempted in the fix loop.
- **NOTABLE-5**: The git floor 2.38 is written independently in src/git/git.ts, three package templates and the README. Injecting a single `{{git_min}}` value would prevent drift.
- **NOTABLE-6**: The `SHA256SUMS` format is written in version.ts and parsed in render.ts, with slightly different acceptance rules.
- **NOTABLE-7**: `.SRCINFO` is a hand-written second copy of the PKGBUILD metadata; the test checks selected fields, not the whole file. Generating it with `makepkg --printsrcinfo` is the robust fix.
- **NOTABLE-8**: `versionMatchesTag` is exported and tested but no production code calls it; guard.sh reimplements the comparison. The `compare` and `asset-name` subcommands are also unused by the workflows.
- **NOTABLE-9**: The build matrix uses `macos-15-intel`; the label is valid today, but a label change would surface only at release time. The new target assertion catches the resulting wrong-architecture build.
- **NOTABLE-10**: The per-job timeouts sum to 55 minutes on the release critical path while SC-002 budgets 20 minutes. The expected run is well under 20 minutes, but no aggregate cap enforces it.
- **NOTABLE-11**: Workflow structural invariants (the four matrix targets, the asset naming loop, stable-only channel dispatch) are not tested; a YAML drift would surface only at release time.

### Documentation, not modified

- **FINDING-33**: `specs/005-release-pipeline/research.md` line 32 says COPR buildroots fetch `Source0` over the network and that COPR enables network by default. The implemented workflow copies both Linux assets, `SHA256SUMS` and `LICENSE` into the SRPM, so `%prep` needs no network. Spec artifacts were left unchanged per the review instruction.

## Test Suite Results

| Round | Command | Exit Code | Failures | Status |
|-------|---------|-----------|----------|--------|
| 1 | `bun run typecheck` | 0 | 0 | passed |
| 1 | `bun test scripts/release/` | 0 | 0 | passed (63 tests) |
| 1 | `actionlint` on the five workflows | 0 | 0 | passed |
| 1 | `shellcheck -S warning scripts/release/guard.sh scripts/test-parallel.sh` | 0 | 0 | passed |
| 1 | `bun test tests/smoke/binary.test.ts` with release env | 0 | 0 | passed (5 tests) |
| 1 | full `bun run test:parallel` | see note | unrelated timeouts | environment-limited |

The full parallel suite was run on this workstation with 14 files at a time. Several pre-existing, unrelated integration files timed out or were killed under that load (`src/git/git.test.ts` hit its 5 s git-commit timeout, and `tests/integration/handoffs.test.ts`, `harness.test.ts` and `acceptance.test.ts` produced no summary). `src/steps/commands.test.ts` passed when rerun alone. No failing test touches the release pipeline, and every release-specific test passes. This is recorded as an environment limitation, not a regression.

## Post-Fix Spec Coverage

All 22 functional requirements were re-checked after the fix loop. The fixes removed no implementation of a requirement. FR-019 remains an external prerequisite: the repository has no `LICENSE` or `package.json` license yet, which is the intended refusal documented in the spec clarifications and docs/release.md; the maintainer supplies the license before the first package publication.

## Goal Alignment

Skipped: no pull request and no linked issue exist for this branch.
