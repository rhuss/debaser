# Release pipeline

A release starts with a tag and ends with four platform binaries plus a
`SHA256SUMS` file on the GitHub release. The four channel workflows then feed
Homebrew, Fedora COPR, the AUR and the apt repository from that release. mise
reads the release assets directly and needs no automation.

## Tag contract

- A release triggers on a tag `v<version>`, for example `v0.1.0`.
- The version after `v` must be a semantic version and must equal the
  `version` field in `package.json`. `package.json` is the single source: the
  binary prints that value for `debaser --version`.
- A version with a hyphen (`v0.2.0-rc.1`) is a pre-release. It publishes the
  same four binaries and checksums as a pre-release entry, and no stable
  channel moves.
- The tagged commit must be contained in `origin/main` and must have a
  successful `ci.yml` push run for exactly that commit. A refused release is
  retried for the same tag without moving it.
- A release for a version that already exists is refused. Published assets are
  never replaced or removed.

`scripts/release/version.ts` owns the rules, and `scripts/release/guard.sh`
applies them in the `guard` job. `bun test scripts/release/version.test.ts`
covers the pure part without network.

## What the release publishes

| Asset | Platform |
|---|---|
| `debaser-<version>-linux-amd64` | Linux x86_64 |
| `debaser-<version>-linux-arm64` | Linux arm64 |
| `debaser-<version>-darwin-arm64` | macOS Apple silicon |
| `debaser-<version>-darwin-amd64` | macOS Intel |
| `SHA256SUMS` | checksums for the four binaries |

Each binary is built on a native runner and must pass
`tests/smoke/binary.test.ts` there before it is uploaded. A release is
published only when all four builds and platform checks passed; a partial
release is never published.

## Required secrets and repositories

All secrets are repository secrets owned by the maintainer. Each channel holds
only the credentials listed for it and never prints one.

| Secret | Used by | Purpose |
|---|---|---|
| `HOMEBREW_TAP_TOKEN` | `channel-homebrew.yml` | Fine-grained token allowed to write `rhuss/homebrew-tap` |
| `COPR_CONFIG` | `channel-copr.yml` | Contents of the maintainer's `~/.config/copr` |
| `AUR_SSH_KEY` | `channel-aur.yml` | SSH private key registered with the AUR account |
| `APT_GPG_KEY` | `channel-apt.yml` | Armored private signing key for the apt repository |
| `APT_GPG_PASSPHRASE` | `channel-apt.yml` | Passphrase of that key |
| `APT_REPO_TOKEN` | `channel-apt.yml` | Token allowed to write `rhuss/debaser-apt` (the `gh-pages` branch) |

The release workflow itself uses the built-in `GITHUB_TOKEN`: `contents: write`
to create the release and `actions: write` to start the channel workflows. No
stored secret is needed for that.

| Repository or account | Used by | Notes |
|---|---|---|
| `rhuss/homebrew-tap` | Homebrew | Branch `main`, formula at `Formula/debaser.rb` |
| COPR project `rhuss/debaser` | Fedora | Built from an SRPM that carries both Linux assets and the checksum file; the buildroot needs no network |
| AUR package `debaser-bin` | Arch | Pushed over SSH to `aur.archlinux.org` |
| `rhuss/debaser-apt` | Debian/Ubuntu | GitHub Pages on the `gh-pages` branch |
| mise | mise | No repository and no credential; the README shows the tool definition |

## Maintainer-owned prerequisites

The pipeline is not complete until each of these exists. None of them is
created by the workflows.

- A `LICENSE` file and a `license` field in `package.json`. Package publication
  is refused while either is missing (FR-019). Which license the project uses
  is the maintainer's choice; the code does not pick one.
- The Homebrew tap repository and the token that writes it.
- The COPR project and its API credentials.
- The AUR package name and an SSH key registered with AUR.
- The apt repository, its signing key, and the public half published.
- Each secret in the table above.

## Local validation

`specs/005-release-pipeline/quickstart.md` lists the local checks. The two that
run without any credential or published release:

```bash
bun test scripts/release/
bun scripts/release/render.ts --version 0.1.0 --sums <dir-with-SHA256SUMS> --out /tmp/packaging
```

The render call reads `package.json` and `LICENSE` from the current directory
and refuses when no license is recorded.

## Dry run

`release.yml` takes two `workflow_dispatch` inputs: `tag` (required) and
`dry_run` (default `false`). A dry run runs the guard, builds on all four
platforms and runs each platform check, then stops before `gh release create`.
It uses the same tag as a real release, so it can also validate a retry.

```bash
gh workflow run release.yml -f dry_run=true -f tag=v0.1.0
gh run watch
```

A tag push publishes automatically. A manual dispatch with `dry_run=false`
publishes too: that is how a release refused before it existed (the guard, a
missing test run, a failed build, a failed platform check) is retried for the
same tag without moving it.

Once `gh release create` has made the release, a retry stops at the
existing-release check, because published assets are never replaced. If a
release exists but is incomplete (asset upload failed), delete it first and
rerun for the same tag:

```bash
gh release delete v0.1.0 --yes
gh workflow run release.yml -f dry_run=false -f tag=v0.1.0
```

```bash
git tag v0.1.0
git push origin v0.1.0

# Retry the same tag without moving it:
gh workflow run release.yml -f dry_run=false -f tag=v0.1.0
```

## How the channels start

After publishing, the release workflow starts the four channel workflows itself
with `workflow_dispatch`. A release created with the built-in `GITHUB_TOKEN` does
not raise `release: published` for other workflows, so depending on that event
alone would leave every channel waiting for a maintainer. The
`release: published` trigger stays as a safety net for a release created by
hand. A pre-release starts no channel.

## Channel retries

Every `channel-*.yml` workflow also runs on demand with a `tag` input. A retry
downloads the same release assets, never rebuilds them, and refuses to move a
channel backwards. A release whose channel update failed stays available; run
that one workflow alone.

```bash
gh workflow run channel-homebrew.yml -f tag=v0.1.0
gh workflow run channel-copr.yml -f tag=v0.1.0
gh workflow run channel-aur.yml -f tag=v0.1.0
gh workflow run channel-apt.yml -f tag=v0.1.0
```

A pre-release tag is a no-op for every channel: the job exits without pushing.

## mise

mise reads the release assets directly, so it needs no workflow and no
credential. The definition the README shows, repeated here so the operator guide
and the user-facing install list agree:

```toml
[tools."http:debaser"]
version = "0.1.0"
url = 'https://github.com/rhuss/debaser/releases/download/v{{ version }}/debaser-{{ version }}-{{ os(macos="darwin") }}-{{ arch(x64="amd64") }}'
bin = "debaser"
```

mise serves any exact version, stable or pre-release. It is not a stable
channel, so a pre-release reaches early testers through mise alone.

## Verification status before the first release

What was checked locally, and what still needs a published release.

- **Rules and templates**: `bun test scripts/release/` covers tag parsing, the
  pre-release rule, asset names, the downgrade comparison, checksum formatting,
  license refusal and every template's rendered text.
- **Template rendering**: `bun scripts/release/render.ts --version 0.1.0
  --sums <dir> --out <dir>` wrote all five files with no placeholder left, and
  `sha256sum -c SHA256SUMS` passed on the synthetic checksum file. Rendering
  again with `--arch arm64` produced `arch: arm64`.
- **FR-019 guard**: rendering from this repository currently exits 1 with
  `no license in package.json`, because no license is recorded yet. That is the
  intended refusal, not a defect.
- **Workflows**: `actionlint` reports no issues on the release and channel
  workflows.
- **COPR source RPM**: `rpmbuild -bs` ran in an `ubuntu:24.04` container with
  rpm 4.18. The SRPM bundles both Linux assets, `SHA256SUMS` and `LICENSE`, so
  the Fedora buildroot needs no network and both architectures build from the
  one SRPM.
- **Dry run (SC-002 budget, four platform results)**: not run. The release
  workflow has to be on the default branch before `gh workflow run release.yml`
  can dispatch it, and this change is not pushed. After merge, run:

  ```bash
  gh workflow run release.yml -f dry_run=true -f tag=v0.1.0
  gh run watch
  ```

  Record the run URL, the duration against the 20-minute budget, and the four
  `build (<target>)` job results here.
- **Install commands (SC-007)**: not run, because no channel exists yet. The
  apt command cannot work until `rhuss/debaser-apt` serves a signed `Release`.
  AUR needs Arch's package build tools, COPR needs a Fedora system, and the
  Homebrew formula needs a Mac or a Linux machine with Homebrew. Check each
  after the first release and record the result here.

## Release audit

Run after each release. The queries answer the measurable outcomes directly.

```bash
# SC-003 and SC-004: every platform job passed and the binary reports the tag.
gh run list --workflow release.yml --limit 10 --json databaseId,conclusion,displayTitle
gh run view <run-id> --json jobs --jq '.jobs[] | "\(.name): \(.conclusion)"'
gh release view "v<version>" --json assets --jq '.assets[].name'

# SC-006: the version each stable channel serves (newest or previous only).
brew info --json=v2 rhuss/tap/debaser | jq -r '.formulae[0].versions.stable'
curl -fsS 'https://copr.fedorainfracloud.org/api_3/build/list?ownername=rhuss&projectname=debaser&state=succeeded&limit=1000' |
  jq -r '[.items[].source_package.version] | map(sub("-[^-]+$"; "")) | unique | .[]' | sort -V | tail -1
rm -rf /tmp/aur-check
git clone --depth 1 ssh://aur@aur.archlinux.org/debaser-bin.git /tmp/aur-check
sed -n 's/^pkgver=//p' /tmp/aur-check/PKGBUILD
curl -fsSL https://rhuss.github.io/debaser-apt/dists/stable/main/binary-amd64/Packages | grep '^Version:'

# SC-008: no stable channel may carry a pre-release version. Test each served
# version rather than looking for a hyphen: build metadata may contain one.
bun scripts/release/version.ts is-prerelease "<version>"   # must print false
```

Also check the release run's wall time against SC-002's 20-minute budget, and
that the release page lists exactly four binaries plus `SHA256SUMS`.
