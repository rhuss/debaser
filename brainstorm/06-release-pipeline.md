# Brainstorm: Release pipeline and distribution channels

**Date:** 2026-11-27
**Status:** active
**Issue:** [#12](https://github.com/rhuss/debaser/issues/12), [#13](https://github.com/rhuss/debaser/issues/13)

## Problem Framing

debaser has no release. The README's Install section tells people to download a binary for their platform, and that binary does not exist, so anyone without Bun 1.4 has to clone the repository and build. #12 covers publishing macOS and Linux binaries from a tag; #13 covers a Homebrew tap on top of them. This session widened the scope to every install channel we want to support: the release binaries plus Homebrew, Fedora COPR, Arch AUR, an apt repository, and mise. Third-party channels only.

Success: on macOS arm64 and x64 and on Linux arm64 and x64, a user installs debaser with one command from a channel they already use, and the installed binary reports the tagged version. Pushing a tag is the only action needed to release.

Failure even if it technically works: channels drift to different versions and nobody notices; a binary reports a version other than its tag; a release ships a platform nobody smoke-tested; installing still needs Bun.

Non-goals:

- Official Fedora and Debian archives. They require packages built from source, Bun is not packaged in either, and neither accepts a prebuilt binary, so this needs a Go or Rust rewrite or bundling that both would reject.
- Windows.
- Snap, Flatpak and AppImage: sandboxed or desktop-GUI formats that fight a CLI reading arbitrary repositories.
- npm publication (`package.json` is `private`, and the binary is the product).
- A CHANGELOG file. Release notes come from GitHub's generated notes.

## Approaches Considered

The first choice was what the channel packages contain; the second was how the automation is arranged.

### A: Source builds in each channel
Fedora spec, AUR PKGBUILD and Homebrew formula all build from the repository with Bun.

- Pros: native-looking packages; a path toward official archives if Bun ever lands there.
- Cons: Bun is missing from the Fedora and Debian buildroots; every build is slow; the installed binary differs from the checksummed artifact; each channel needs its own packaging format maintained by hand.
- Dropped.

### B: Repackaged binaries, one release workflow
All channels consume the same four binaries from the GitHub release. A single workflow runs the build matrix, the smoke tests, the release and every channel job.

- Pros: one file; version and artifact handling in one place.
- Cons: every channel's secrets and permissions share one scope; a channel re-run replays the workflow.

### C: Repackaged binaries, release workflow plus one workflow per channel (chosen)
The release workflow builds, smoke-tests and publishes. Separate `tap`, `copr`, `aur` and `apt` workflows are triggered by `release: published` and can each be run alone with `workflow_dispatch`.

- Pros: failure isolation; per-channel tokens and permissions; adding a channel later (Nix, openSUSE, Alpine) is one new file; the independent catch-up that was agreed is native to this layout.
- Cons: about five small workflow files; each channel workflow resolves the release by tag and filters pre-releases itself.

## Decision

C, with repackaged binaries. The independent catch-up the user chose is exactly what per-channel workflows give: a broken AUR push neither blocks nor invalidates the release, and re-running it is one click. Repackaging keeps a single set of bits behind `SHA256SUMS`, and source builds are ruled out by Bun's absence from the distro buildroots.

## Key Requirements

Release:

- Trigger: a `v<version>` tag. The workflow fails before publishing when the tag and `package.json` disagree, because `--version` is compiled in from `package.json` (`src/cli/main.ts:37`) and a mismatch would ship a binary that lies about itself.
- Only a tag on a commit whose CI passed produces a release.
- Build with Bun 1.4.4, pinned as in `ci.yml`, for `bun-linux-x64`, `bun-linux-arm64`, `bun-darwin-arm64` and `bun-darwin-x64`.
- Every target is smoke-tested on a native runner of that platform: `debaser --version` plus a short live run. This settles #12's open question about whether the live worker loads in a compiled binary, since `live.ts` resolves `./live/worker.ts` from the bundle root only when `import.meta.url` starts with `file:///$bunfs/`.
- Assets named `debaser-<version>-<os>-<arch>`, plus a `SHA256SUMS` file. The naming is my proposal, chosen so the formula, PKGBUILD and mise entry can rely on it.
- Stable tags publish a GitHub release with generated notes. A pre-release tag (e.g. `v0.2.0-rc.1`) publishes a GitHub pre-release and nothing else; the installer channels ignore pre-releases, and mise can still install one by exact version.
- The GitHub release stands on its own. Each channel catches up independently when re-run; a failed channel never blocks or invalidates a release.

Channels:

- Homebrew tap `rhuss/homebrew-tap` with a `debaser` formula that downloads the platform binary, checks its SHA256, declares `git`, and tests `debaser --version` (#13).
- Fedora COPR project whose spec packages the release binary, so no Bun is needed in the buildroot.
- AUR `debaser-bin` PKGBUILD that downloads the release binary and its checksum.
- apt repository serving a `.deb` per architecture, signed.
- mise: a one-time registry entry pointing at the release assets. No per-tag automation.
- deb and rpm come from one generator with shared version, description, license and the `git >= 2.38` dependency (README's stated minimum). The AUR PKGBUILD and Homebrew formula stay hand-written, since each is a short file.

## Open Questions

- Where the apt repository and its signing key live: GitHub Pages of this repository, a separate repository, or a hosted service such as Cloudsmith.
- Which tokens write to the tap, to COPR and to AUR, and how they are held (deploy keys, app tokens, SSH keys).
- Which runner serves x64 macOS now that `macos-13` is being retired; check `macos-15-intel`.
- Whether `brew install` on Linux is in scope or macOS only.
- Whether the arm64 Linux build uses the hosted `ubuntu-24.04-arm` runner or cross-compiles with the smoke test on a runner.
- The first release version: tag `0.1.0` as it stands, or bump to something meaningful before the first tag.
- There is no LICENSE file in the repository, and both the Fedora spec and the formula want a license.
