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

## Complexity Tracking

No constitution violations. Two choices need a note because they carry real cost:

| Choice | Why Needed | Simpler Alternative Rejected Because |
|--------|------------|-------------------------------------|
| Fedora COPR via a generated SRPM and `copr-cli` | The spec requires a Fedora channel, and COPR accepts only source RPMs | Publishing an RPM asset from the release alone gives no `dnf install` channel, which the spec requires |
| Apt repository on GitHub Pages, with the `.deb` files in that repository | apt needs a stable signed repository, and the maintainer controls where it lives | A hosted packaging service adds a third-party account and a credential; Cloudsmith remains the fallback if repository growth becomes a problem |
