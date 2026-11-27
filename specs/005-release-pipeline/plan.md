# Implementation Plan: Release pipeline and distribution channels

**Branch**: `005-release-pipeline` | **Date**: 2026-11-27 | **Spec**: [spec.md](./spec.md)

**Input**: Feature specification from `/specs/005-release-pipeline/spec.md`

## Summary

A `v<version>` tag builds the CLI on four native machines (Linux and macOS, amd64 and arm64), runs the existing compiled-binary smoke test on each, and publishes the four binaries plus a `SHA256SUMS` file as a GitHub release. Four small workflows then feed the installation channels from that release: a Homebrew tap, a Fedora COPR project, an AUR `-bin` package, and a signed apt repository. mise is documented against the release assets and needs no per-release automation. Each channel runs independently, refuses pre-releases, and never downgrades.

## Technical Context

**Language/Version**: TypeScript on Bun 1.4.4 (existing project; Bun pinned to the version CI already uses)

**Primary Dependencies**: Bun's single-file compiler (`bun build --compile`, existing `bun run build` script); GitHub Actions runners and `gh`; nfpm for Debian packages; `rpmbuild` plus `copr-cli` for Fedora; `apt-ftparchive` and GnuPG for the apt repository; `git` and `curl` in channel jobs. No new runtime dependency for the CLI itself.

**Storage**: No database. State lives in GitHub releases (immutable assets) and in the channel repositories (tap formula, AUR PKGBUILD, apt `Packages`/`Release`, COPR project).

**Testing**: `bun test` with `scripts/test-parallel.sh` for the suite; the existing `tests/smoke/binary.test.ts` becomes the per-platform check and must run against the binary that will be published; new unit tests for release helpers (tag parsing, asset naming, pre-release rule, version comparison, template rendering).

**Target Platform**: The release runs on GitHub-hosted runners: `ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, `macos-15-intel` (verified available to public repositories). The product targets Linux and macOS on amd64 and arm64.

**Project Type**: CLI tool with a release pipeline (single repository; no new application surface)

**Performance Goals**: Tag push to published binaries in under 20 minutes (SC-002). A warm `debaser --version` stays under 100 ms, already asserted by the smoke test.

**Constraints**: Native builds only, no cross-compilation, so every published binary has run on a machine of its own platform. Bun pinned to 1.4.4. Published assets are immutable. Channel jobs hold one credential each and must never log secrets. No channel may downgrade.

**Scale/Scope**: Four platform builds, four channel workflows, roughly five packaging templates, and low release frequency.

## Constitution Check

*GATE: Must pass before Phase 0 research. Re-check after Phase 1 design.*

`.specify/memory/constitution.md` is still the unfilled template: it defines no principles and no gates. There is nothing to violate and nothing to justify. Project conventions observed instead: tests with every change (`bun test`), one behavior per test with a sentence-style title, no new runtime dependency, and documentation updated with behavior.

**Post-design re-check**: the design adds CI and packaging files plus two small testable helper modules. It adds no runtime dependency and no new user-facing command, so the same conclusion holds.

## Project Structure

### Documentation (this feature)

```text
specs/005-release-pipeline/
├── plan.md              # This file
├── research.md          # Phase 0 decisions
├── data-model.md        # Release, artifact, channel, package
├── quickstart.md        # Local validation guide
├── contracts/
│   ├── assets.md        # Asset naming, checksums, immutability
│   └── channels.md      # Install commands and channel metadata
└── tasks.md             # Phase 2 output
```

### Source Code (repository root)

```text
.github/workflows/
├── ci.yml                       # existing; unchanged
├── release.yml                  # NEW: tag -> verify -> build matrix -> publish
├── channel-homebrew.yml         # NEW: release published -> tap formula
├── channel-copr.yml             # NEW: release published -> COPR build
├── channel-aur.yml              # NEW: release published -> AUR push
└── channel-apt.yml              # NEW: release published -> apt repo

packaging/
├── homebrew/debaser.rb.tmpl     # NEW: formula template
├── aur/PKGBUILD.tmpl            # NEW: debaser-bin package
├── aur/SRCINFO.tmpl             # NEW: rendered .SRCINFO
├── rpm/debaser.spec.tmpl        # NEW: spec packaging the release binary
└── deb/nfpm.yaml.tmpl           # NEW: deb metadata

scripts/release/
├── version.ts                   # NEW: tag/version rules, asset names, downgrade check
├── render.ts                    # NEW: render the packaging templates
├── version.test.ts              # NEW
└── render.test.ts               # NEW

tests/smoke/binary.test.ts       # MODIFIED: skip its own rebuild when the binary is prebuilt
README.md                        # MODIFIED: install section per channel
LICENSE                          # maintainer dependency; publication guard lands here
```

**Structure Decision**: The pipeline is configuration plus shell, with the risky pure rules (tag parsing, asset naming, pre-release detection, downgrade comparison, template rendering) in two small TypeScript modules under `scripts/release/`, which `bun test` covers. The workflows stay thin: they call these helpers and the channel tools. Templates live under `packaging/` so a channel workflow can render them without a person.

## Global Constraints

Copied from the spec; every task inherits these.

- Tag form `v<semantic-version>`; the version must equal `package.json`'s version; a hyphen in the version means pre-release.
- Assets: `debaser-<version>-<os>-<arch>` with `<os>` in `linux`/`darwin` and `<arch>` in `amd64`/`arm64`, no leading `v`.
- `SHA256SUMS`: one SHA-256 line per asset, `sha256sum -c` compatible.
- Four targets only: `linux-amd64`, `linux-arm64`, `darwin-arm64`, `darwin-amd64`.
- Stable channels: Homebrew, COPR, AUR, apt. mise is not a stable channel.
- No published asset is replaced or removed; no channel moves backwards.
- `git >= 2.38` in package metadata; the CLI already enforces it at runtime.
- Bun pinned to 1.4.4.
- Third-party channels only; official Fedora and Debian archives are out of scope.

## Interfaces

Neighbouring tasks need these names and shapes. Tasks that consume them reference this list instead of restating them.

```ts
// scripts/release/version.ts
export type Target = { os: "linux" | "darwin"; arch: "amd64" | "arm64" };
export const TARGETS: Target[];                       // the four targets, in asset order
export function parseTag(tag: string): string;        // version, or throws on a malformed tag
export function assetName(version: string, t: Target): string;
export function isPrerelease(version: string): boolean;
export function compareVersions(a: string, b: string): number; // <0, 0, >0
export function sumsLine(sha256: string, name: string): string; // "<hex>  <name>"
```

```ts
// scripts/release/render.ts
export function render(template: string, values: Record<string, string>): string; // throws on an unresolved placeholder
export function licenseOf(pkg: unknown, licenseFile: string | null): string;      // throws when none is recorded
```

```bash
# scripts/release/guard.sh
# Env: TAG, SHA, GH_TOKEN. Exit 0 only when the tag matches package.json,
# the commit has a successful ci.yml run, and no release exists for the version.
```

```yaml
# workflow_dispatch inputs shared by release.yml and every channel-*.yml
tag: string        # v-prefixed; required
dry_run: boolean    # release.yml only, default false
```

## Review Focus

Failure modes the spec implies, each owned by a task with a test or a guard step:

- A `SHA256SUMS` line with one space or a wrong name: `sumsLine` tests (T010).
- An asset missing from the release: the publish job refuses (T012).
- A template rendering with a placeholder left behind: `render` refuses and is tested (T005, T006).
- A tag that is well formed but disagrees with `package.json`: guard refuses (T008, T009).
- A tag with no CI run for its exact SHA: guard refuses (T008).
- A pre-release reaching a stable channel: each channel workflow skips it (T018, T025, T026, T027), and `isPrerelease` is tested (T004).
- A channel retry for an older tag: `compareVersions` refuses it (T004, T018, T025 to T027).
- No license recorded: rendering refuses (T005, T006).

## Complexity Tracking

No constitution violations. Two choices need a note because they carry real cost:

| Choice | Why Needed | Simpler Alternative Rejected Because |
|--------|------------|-------------------------------------|
| Fedora COPR via a generated SRPM and `copr-cli` | The spec requires a Fedora channel, and COPR accepts only source RPMs | Publishing an RPM asset from the release alone gives no `dnf install` channel, which the spec requires |
| Apt repository on GitHub Pages, with the `.deb` files in that repository | apt needs a stable signed repository, and the maintainer controls where it lives | A hosted packaging service adds a third-party account and a credential; Cloudsmith remains the fallback if repository growth becomes a problem |
