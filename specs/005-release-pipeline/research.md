# Research: Release pipeline

All decisions below resolve the unknowns in the plan's Technical Context. Evidence was read from the repository and from GitHub's hosted-runner documentation on 2026-11-27.

## R1: Build natively per platform instead of cross-compiling

- **Decision**: Run `bun run build` on one native runner per target (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, `macos-15-intel`) and publish what each runner built.
- **Rationale**: FR-006 requires each binary to run on its own platform before publication. A native build makes that the same machine, removes any question about `bun build --compile --target=...` support at 1.4.4, and removes the cross-compilation risk issue #12 names. Bun is pinned to 1.4.4, the version `ci.yml` already uses.
- **Alternatives considered**: Cross-compiling all four targets on one host (rejected: the produced binary still needs a machine of its platform to run, so the matrix exists anyway). Shipping without per-platform runs (rejected: violates FR-006 and SC-004).
- **Evidence**: `bun --version` is 1.4.4 locally; `package.json` defines `build` as `bun build --compile src/cli/main.ts src/live/worker.ts --outfile dist/debaser`; `ci.yml` already builds and runs `./dist/debaser --version` on ubuntu-latest and macos-latest.
- **Runner labels**: GitHub's hosted-runner documentation lists `ubuntu-24.04-arm`, `ubuntu-22.04-arm`, `macos-15-intel`, `macos-26-intel`, and states that standard hosted runners are free and unlimited for public repositories. This repository is public. `macos-13` is retired, hence `macos-15-intel` for x64.

## R2: Reuse the existing compiled-binary smoke test as the platform check

- **Decision**: The per-platform check is `bun test tests/smoke/binary.test.ts` run on each native runner. Add one env flag (`DEBASER_BINARY_PREBUILT=1`) so the test's `beforeAll` keeps the workflow's binary instead of rebuilding it.
- **Rationale**: That file already asserts version output, a real add/build/status flow, a live-view build under a pseudo terminal using `script` (so the worker in a compiled binary is exercised), the built-in recipes travelling in the binary, and a warm start under 100 ms. Running it on the release binary turns the #12 open question into a gate rather than a manual check.
- **Alternatives considered**: A separate shell script (rejected: duplicates the test world, which the TypeScript helpers provide). Only `--version` (rejected: does not exercise the live worker, the exact risk in #12).
- **Evidence**: `tests/smoke/binary.test.ts` exists and covers all of the above; the pty branch already handles darwin (`script -q /dev/null`) and linux (`script -qec`).

## R3: Version and tag rules live in one testable helper

- **Decision**: `scripts/release/version.ts` owns tag parsing, the `v<version>` form, the pre-release rule (a hyphen in the version), the asset name, and the downgrade comparison. Workflows call it through `bun`; `version.test.ts` covers it.
- **Rationale**: These rules are the ones that fail silently (wrong asset name, a pre-release reaching a stable channel, a downgrade). Keeping them in TypeScript matches the project's test style and avoids untestable shell conditionals.
- **Alternatives considered**: Shell functions in each workflow (rejected: four copies, no tests). A new CLI verb (rejected: it would surface build-only behavior in the user-facing tool).
- **Evidence**: `main.ts:37` compiles `package.json`'s version into the binary, so `package.json` is the single source FR-002 asks for. A version with a hyphen is the semantic-version pre-release form.

## R4: Fedora through COPR with a generated SRPM

- **Decision**: `packaging/rpm/debaser.spec.tmpl` packages the release binaries and `SHA256SUMS` as sources bundled into the SRPM; `%prep` selects the asset for `%{_arch}` (`x86_64`/`aarch64` mapped to `amd64`/`arm64`) from the bundle. The workflow installs `rpm-build` and `copr-cli`, builds the SRPM with `rpmbuild -bs`, and submits it with `copr-cli build`.
- **Rationale**: COPR accepts source RPMs only, so a binary RPM built by nfpm cannot be uploaded. The spec's `%prep` fetches the already-published asset, keeping the "repackaged binaries" decision: no Bun in the buildroot and no second build. COPR builds both architectures from the same SRPM.
- **Alternatives considered**: Building from source in COPR (rejected: Bun is not in Fedora, and it contradicts the agreed repackaging). nfpm's RPM output uploaded somewhere other than COPR (rejected: no `dnf`-installable channel).
- **Risks**: The spec must declare a license, which is the maintainer dependency FR-019 guards. The SRPM embeds the assets, so the COPR buildroot needs no network.

## R5: AUR with a rendered `-bin` PKGBUILD and matching `.SRCINFO`

- **Decision**: Ship `packaging/aur/PKGBUILD.tmpl` and `packaging/aur/SRCINFO.tmpl`; the workflow renders both with the version and per-architecture checksums, clones `ssh://aur@aur.archlinux.org/debaser-bin.git`, commits, and pushes.
- **Rationale**: AUR accepts only pushes where `.SRCINFO` matches the PKGBUILD. The package shape is fixed (`source_x86_64`/`source_aarch64`, `sha256sums_*`, `package()` installing the binary), so a rendered template is deterministic and needs no Arch tooling in CI.
- **Alternatives considered**: Running `makepkg --printsrcinfo` in an Arch container (rejected: needs a non-root user inside the container for one deterministic file). A source-building PKGBUILD (rejected: repackaging decision).
- **Evidence**: The assets are bare binaries named `debaser-<version>-linux-<arch>`, so `package()` installs to `/usr/bin`.

## R6: apt repository on GitHub Pages

- **Decision**: Publish `.deb` files plus `Packages`, `Release`, `Release.gpg` and `InRelease` to a dedicated repository (`rhuss/debaser-apt`, `gh-pages`), using `nfpm` for the packages, `apt-ftparchive` for the indexes, and a maintainer-held GnuPG key as a repository secret. Users install the published public key and add a `signed-by` source.
- **Rationale**: The maintainer controls the host, no third-party account is required, and GitHub Pages serves the files over HTTPS at a stable URL. nfpm builds both `.deb` architectures from one YAML configuration.
- **Alternatives considered**: Cloudsmith (rejected for now: another account and credential, though it avoids repository growth). Hosting the `.deb` files in the main repository's releases (rejected: apt needs a repository-relative pool). A PPA (rejected: needs Launchpad and per-version uploads).
- **Risk**: Binary sizes make the `gh-pages` history grow. Mitigation: publish each release into a fresh orphan commit (no history) once growth matters; recorded as an open item in the plan's tasks.

## R7: Homebrew formula rendered per release

- **Decision**: `packaging/homebrew/debaser.rb.tmpl` renders four URL/SHA256 pairs split by `on_macos`/`on_linux` and `Hardware::CPU.arm?`; `depends_on "git"`; `test do` runs `debaser --version`; the workflow pushes to `rhuss/homebrew-tap` with a fine-grained token.
- **Rationale**: Matches issue #13's acceptance (macOS arm64 and Linux amd64/arm64) and needs no source build. Homebrew cannot express a minimum `git` version in `depends_on`, which is why FR-016 also requires a runtime check.
- **Alternatives considered**: A formula that builds from source with Bun (rejected: repackaging decision, and Bun is not available through Homebrew).

## R8: mise without a per-release workflow

- **Decision**: Document a mise tool definition in the README that points at the release assets; no workflow and no registry repository.
- **Rationale**: mise reads release assets directly, and FR-014 only requires an exact-version install. This removes a dependency and a maintenance surface.
- **Alternatives considered**: A `ubi:` tool with a matching regex (viable, but the `http:` form states the URL explicitly). An official `mise-registry` entry (rejected: a pull request to another repository, and no functional gain for this feature).
- **Verified**: mise's `http` backend documentation (read 2026-11-27) defines `{{ version }}`, `{{ os() }}` (`linux`/`macos`) and `{{ arch() }}` (`x64`/`arm64`), and both accept renaming arguments. The definition uses `{{ os(macos="darwin") }}` and `{{ arch(x64="amd64") }}`, which produce exactly the asset names. The URL must be a single-quoted TOML string because it contains double quotes. No fallback is needed.

## R9: Gate on a passing test run for the tagged commit

- **Decision**: The release workflow's guard job requires the tagged commit to be contained in `origin/main` (`git merge-base --is-ancestor`, with a full-history checkout via `fetch-depth: 0`), then queries the CI workflow runs for that commit (`gh run list --workflow ci.yml --commit <sha> --json conclusion,headSha,event`) and refuses unless a `push` run for that exact SHA concluded `success`. Filtering on the event matters because `ci.yml` also runs on pull requests.
- **Rationale**: `ci.yml` triggers on `main` pushes and pull requests, so a tag alone carries no result. Reusing the commit's green run satisfies FR-003 without a second full test pass, and the SHA check closes the race the edge case describes.
- **Alternatives considered**: Re-running the suite inside the release (rejected: doubles the runtime for little gain; SC-002 has a budget). Trusting the tag (rejected: violates FR-003).
- **Evidence**: `.github/workflows/ci.yml` triggers on `push: branches: [main]` and `pull_request` only, with the job named `test (<os>)`.

## R10: git version requirement is already enforced

- **Decision**: No runtime code change for the minimum `git` version. Package metadata declares `git >= 2.38` where the format supports it; the Homebrew formula declares `git` without a constraint; the CLI's existing check covers users who arrive with an older `git`.
- **Rationale**: `git.requireVersion` (default `2.38`) is already called from `src/cli/main.ts:90`, `src/run/build.ts:53` and `src/run/rebase-phase.ts:133`, with a test at `src/git/git.test.ts:9` that pins the message. FR-016's runtime half is therefore already met.
- **Alternatives considered**: A new startup check (rejected: duplicates an existing, tested one).
