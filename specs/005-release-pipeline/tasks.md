# Tasks: Release pipeline and distribution channels

**Input**: Design documents from `/specs/005-release-pipeline/`

**Prerequisites**: plan.md, spec.md, research.md, data-model.md, contracts/

**Tests**: Required by project convention (`bun test` with every change). Test tasks are included for every rule that can fail silently.

**Organization**: Tasks are grouped by user story so each channel can be built and verified on its own.

## Format: `[ID] [P?] [Story] Description`

- **[P]**: Can run in parallel (different files, no dependencies)
- **[Story]**: Which user story this task belongs to (US1, US2, US3, US4)
- Exact file paths are given in every task

## Path Conventions

Single project: `src/`, `tests/`, `scripts/`, `packaging/`, `.github/workflows/` at repository root.

---

## Phase 1: Setup (Shared Infrastructure)

**Purpose**: Directory layout for packaging and release scripts

- [ ] T001 Create the `packaging/homebrew`, `packaging/aur`, `packaging/rpm`, `packaging/deb` and `scripts/release` directories with `.gitkeep` files so the layout matches plan.md
- [ ] T002 [P] Add `docs/release.md` with sections for the tag contract, the required secrets per channel, and the maintainer-owned prerequisites from spec.md's Dependencies

---

## Phase 2: Foundational (Blocking Prerequisites)

**Purpose**: The pure release rules and the guard that every story relies on

**⚠️ CRITICAL**: No channel workflow or release workflow can be written before these exist

- [ ] T003 Implement `scripts/release/version.ts`: `parseTag(tag)` (accepts `v<semver>` only, rejects a leading `v` inside the version), `assetName(version, os, arch)` (returns `debaser-<version>-<os>-<arch>` with `<os>` in `linux`/`darwin`, `<arch>` in `amd64`/`arm64`, no leading `v`), `isPrerelease(version)` (true when the version contains a hyphen), and `compareVersions(a, b)` (semantic-version ordering that understands pre-release suffixes)
- [ ] T004 [P] Unit tests for `scripts/release/version.ts` in `scripts/release/version.test.ts` covering: well-formed and malformed tags, `0.1.0` versus `v0.1.0`, each of the four asset names, `0.2.0-rc.1` as a pre-release and `0.2.0` as stable, and `0.1.0` versus `0.10.0` versus `0.2.0` ordering
- [ ] T005 Implement `scripts/release/render.ts`: a small placeholder renderer (`{{name}}` substitution, refusal on any unresolved placeholder) plus `licenseOf(packageJson, licenseFile)` that throws when the project records no license (FR-019) and accepts `package.json`'s `license` field or a `LICENSE` file
- [ ] T006 [P] Unit tests for `scripts/release/render.ts` in `scripts/release/render.test.ts` covering substitution, refusal on a leftover placeholder, and refusal when no license exists
- [ ] T007 Modify `tests/smoke/binary.test.ts` so its `beforeAll` rebuild is skipped when `DEBASER_BINARY_PREBUILT=1`, keeping the workflow's binary under test
- [ ] T008 Implement `scripts/release/guard.sh`: checks the tag is well formed, that it equals `v` plus `package.json`'s version, that the commit's CI run (`gh run list --workflow ci.yml --commit <sha>`) concluded successfully for that exact SHA, and that no release for the version exists; exits non-zero with one clear line per failure
- [ ] T009 Add a guard test path in `scripts/release/version.test.ts` for the version-match rule (pure part only), so the refusal is covered without network in CI

**Checkpoint**: Rules and guard exist and are tested; channel work can start

---

## Phase 3: User Story 1 - Install from a published release binary (Priority: P1) 🎯 MVP

**Goal**: A tag produces four platform binaries, their checksums, and a GitHub release, only after every platform check passed.

**Independent Test**: Run the release workflow with `dry_run=true` for a valid tag; all four jobs build and pass; then, on a real tag, download each asset and verify `sha256sum -c SHA256SUMS` and `debaser --version`.

### Tests for User Story 1

- [ ] T010 [P] [US1] Add tests in `scripts/release/version.test.ts` for the `SHA256SUMS` line format (`<hex>  <name>` with two spaces) and for asset-name uniqueness across the four targets

### Implementation for User Story 1

- [ ] T011 [US1] Create `.github/workflows/release.yml` with a `guard` job that runs `scripts/release/guard.sh`, a `build` matrix (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, `macos-15-intel`) that runs `bun run build` and then `DEBASER_BINARY_PREBUILT=1 bun test tests/smoke/binary.test.ts`, and uploads each `dist/debaser` as an artifact
- [ ] T012 [US1] Add the `publish` job to `.github/workflows/release.yml`: download all four artifacts, refuse unless all four are present, generate `SHA256SUMS`, support `workflow_dispatch` inputs `dry_run` and `tag`, create the release with `gh release create` (pre-release flag from `isPrerelease`), generated notes, and no overwrite of an existing release
- [ ] T013 [US1] Add the release workflow's least-privilege permissions (`contents: write`, `checks: read`, `actions: read`) and a concurrency group keyed by the tag in `.github/workflows/release.yml`
- [ ] T014 [P] [US1] Rewrite the README install section for the release binaries in `README.md`: supported platforms, the download-and-verify commands, and the `git` 2.38 requirement
- [ ] T015 [US1] Document the dry run and the real-tag flow for maintainers in `docs/release.md`

**Checkpoint**: US1 is the MVP. A tag can publish verified binaries even if no channel exists yet.

---

## Phase 4: User Story 2 - Install with Homebrew (Priority: P2)

**Goal**: The tap serves the release binary for macOS arm64/x64 and Linux arm64/x64, only for stable releases, never downgrading.

**Independent Test**: Render the formula for a version and compare each URL and SHA-256 with the release's `SHA256SUMS`; on a published release, `brew install rhuss/tap/debaser` and `brew test debaser` pass.

### Tests for User Story 2

- [ ] T016 [P] [US2] Add formula rendering tests in `scripts/release/render.test.ts`: four URL/SHA-256 pairs split by `on_macos`/`on_linux` and `Hardware::CPU.arm?`, `depends_on "git"`, a `test do` block running `--version`, and no unresolved placeholder

### Implementation for User Story 2

- [ ] T017 [P] [US2] Create `packaging/homebrew/debaser.rb.tmpl` with the four platform branches, `version`, `license`, `homepage`, `depends_on "git"`, `bin.install`, and the `test do` block
- [ ] T018 [US2] Create `.github/workflows/channel-homebrew.yml`: trigger on `release: published` and `workflow_dispatch` with a `tag` input; skip pre-releases; use `scripts/release/version.ts` to refuse when the tap already serves a newer version; render the formula, push it to `rhuss/homebrew-tap` with `HOMEBREW_TAP_TOKEN`; state the tap path in the log
- [ ] T019 [US2] Add the Homebrew install command and its supported platforms to `README.md`

**Checkpoint**: US2 works against any published stable release.

---

## Phase 5: User Story 3 - Install from Linux distribution channels (Priority: P3)

**Goal**: Fedora, Arch, and Debian/Ubuntu each install the release binary through their own package manager, at the release version, never downgrading.

**Independent Test**: Render each package for a version and inspect metadata (version, license, `git >= 2.38`, asset name and checksum); on a published release, install on each distribution and check `debaser --version`.

### Tests for User Story 3

- [ ] T020 [P] [US3] Add Debian and RPM rendering tests in `scripts/release/render.test.ts`: version, license, `git (>= 2.38)` / `Requires: git >= 2.38`, architecture mapping to `amd64`/`arm64` and `x86_64`/`aarch64`, and the exact asset name per architecture
- [ ] T021 [P] [US3] Add PKGBUILD and `.SRCINFO` rendering tests in `scripts/release/render.test.ts`: `source_x86_64`/`source_aarch64` URLs, matching `sha256sums_*`, `depends=('git>=2.38')`, and `.SRCINFO` fields matching the PKGBUILD

### Implementation for User Story 3

- [ ] T022 [P] [US3] Create `packaging/deb/nfpm.yaml.tmpl` with name `debaser`, version, license, homepage, `depends: git (>= 2.38)`, the binary to `/usr/bin/debaser`, and the architecture mapping
- [ ] T023 [P] [US3] Create `packaging/rpm/debaser.spec.tmpl` with `Source0` pointing at the release asset for `%{_arch}` (mapping `x86_64`/`aarch64` to `amd64`/`arm64`), `%prep` fetching it, `%install` to `%{_bindir}`, `%license`, `Requires: git >= 2.38`, and the version and license fields
- [ ] T024 [P] [US3] Create `packaging/aur/PKGBUILD.tmpl` and `packaging/aur/SRCINFO.tmpl` for `debaser-bin` with per-architecture sources and checksums
- [ ] T025 [P] [US3] Create `.github/workflows/channel-apt.yml`: build the two `.deb` files with nfpm, update the repository tree with `apt-ftparchive`, sign `Release` with `APT_GPG_KEY`/`APT_GPG_PASSPHRASE`, export the matching public key with `gpg --export` from the same secret to `debaser-archive-keyring.gpg` (armored), publish `rhuss/debaser-apt`, skip pre-releases, refuse downgrades
- [ ] T026 [US3] Create `.github/workflows/channel-copr.yml`: build the SRPM with `rpmbuild -bs`, submit it with `copr-cli build` using `COPR_CONFIG`, skip pre-releases, refuse downgrades
- [ ] T027 [US3] Create `.github/workflows/channel-aur.yml`: render the PKGBUILD and `.SRCINFO`, clone `ssh://aur@aur.archlinux.org/debaser-bin.git` with `AUR_SSH_KEY`, commit only when the version changed, push, and refuse downgrades
- [ ] T028 [US3] Add the Fedora, Arch and Debian/Ubuntu commands, including the apt key and source setup, to `README.md`

**Checkpoint**: US3 works channel by channel; each failure leaves the release alone.

---

## Phase 6: User Story 4 - Install a specific version with mise (Priority: P4)

**Goal**: A developer installs any exact version, including a pre-release, from the release assets.

**Independent Test**: Follow the README's mise snippet for a stable version and for a pre-release on macOS or Linux, and check `debaser --version`.

### Implementation for User Story 4

- [ ] T029 [US4] Document the mise `http` tool definition in `README.md`, with the four platform URL variants and the `bin` name; verify the template variables and the `amd64`/`arm64` mapping against mise's documentation, and note the `ubi:` matching-regex fallback if the mapping cannot be expressed
- [ ] T030 [US4] Add the mise entry to `contracts/channels.md`'s install list in the README and to `docs/release.md`

**Checkpoint**: All four stories are independently usable.

---

## Phase 7: Polish & Cross-Cutting Concerns

- [ ] T031 Run the full suite with `bun run test:parallel` and `bun run typecheck`
- [ ] T032 [P] Verify every template renders against a synthetic `SHA256SUMS` with `bun scripts/release/render.ts --version 0.1.0 --sums <dir> --out /tmp/packaging`, per `quickstart.md`
- [ ] T033 [P] Verify the release workflow's dry run on the default branch with `gh workflow run release.yml -f dry_run=true -f tag=v0.1.0`, and record the run URL, its duration against SC-002's 20-minute budget, and the four platform job results in `docs/release.md`
- [ ] T034 Document every required secret and repository (`HOMEBREW_TAP_TOKEN`, `COPR_CONFIG`, `AUR_SSH_KEY`, `APT_GPG_KEY`, `APT_GPG_PASSPHRASE`, `rhuss/homebrew-tap`, `rhuss/debaser-apt`, COPR project, AUR account) in `docs/release.md`, and list the maintainer-owned prerequisites still missing (LICENSE choice)
- [ ] T035 Review the README install section against spec.md FR-020: every channel, its command, its one-time setup, and the supported platforms

---

## Dependencies & Execution Order

### Phase Dependencies

- **Setup (Phase 1)**: no dependencies
- **Foundational (Phase 2)**: depends on Setup; blocks all stories
- **US1 (Phase 3)**: depends on Foundational; MVP
- **US2 (Phase 4)**: depends on US1 (needs published assets)
- **US3 (Phase 5)**: depends on US1; the three channels are independent of each other
- **US4 (Phase 6)**: depends on US1 only; documentation work
- **Polish (Phase 7)**: depends on the stories being implemented

### User Story Dependencies

- **US1 (P1)**: no dependencies beyond Foundational
- **US2 (P2)**: consumes the release assets from US1
- **US3 (P3)**: consumes the release assets from US1; T022 to T024 and T025 to T027 are independent of each other
- **US4 (P4)**: consumes the release assets from US1

### Within Each Story

- Templates before their workflow, so the workflow has something to render
- Rendering tests before or with the template
- Workflow last, since it is the least testable part and should stay thin

### Parallel Opportunities

- T004, T006, T007 can run together once T003 and T005 exist
- T022, T023, T024 are three independent template files
- T025, T026, T027 are three independent workflows once their templates render
- T032, T033, T034 are independent polish steps

---

## Parallel Example: User Story 3

```bash
# Three templates, three files, no shared state:
Task: "Create packaging/deb/nfpm.yaml.tmpl"
Task: "Create packaging/rpm/debaser.spec.tmpl"
Task: "Create packaging/aur/PKGBUILD.tmpl with packaging/aur/SRCINFO.tmpl"
```

---

## Implementation Strategy

### MVP First (User Story 1)

1. Complete Phase 1 and Phase 2
2. Complete Phase 3: the release workflow and README install section
3. Validate with a dry run, then a real tag
4. This alone satisfies the README's promise and issues #12

### Incremental Delivery

1. US1: verified binaries (MVP)
2. US2: Homebrew, the widest developer reach
3. US3: Fedora first (the requested distribution), then Arch, then apt
4. US4: mise, documentation only
5. Polish: operator guide and full validation

---

## Notes

- The license choice is a maintainer dependency; FR-019's guard lands with the code, and the `LICENSE` file is added when the maintainer chooses one. No task invents a license.
- Workflows stay thin: every rule that can fail silently lives in `scripts/release/` and has a test.
- Each channel workflow is idempotent and safe to re-run alone.
- Commit after each task or logical group, with the project's attribution line.
