---
runbook_version: 1
feature: 005-release-pipeline
status: drafted
mode: light
steps_total: 7
step_results: pending,pending,pending,pending,pending,pending,pending
drafted_at: 1b333cc
drafted_fingerprint: a3778efb0505e18e902de3c0cb366699a5cd5049f9aaa87dc3c630ff88f0993a
tested_at:
tested_fingerprint:
updated: 2026-11-27
---

# Try it: Release pipeline and distribution channels

<!-- runbook-status -->
> **Status:** drafted · 0 of 7 steps · Mode: light · Drafted at 1b333cc · 2026-11-27
<!-- /runbook-status -->

## What you're testing

The release pipeline turns one tag into four verified binaries and feeds five install channels. Everything that decides names, checksums, package metadata and refusals is testable locally; only the tag push, the four-platform CI matrix and the real installs need GitHub and the channel repositories.

The journey runs in this order: build a synthetic release, watch the license guard refuse, render the five package files, inspect the Homebrew formula, inspect the RPM and AUR metadata, run the release rules, and finally build and exercise the compiled binary the way a release does.

## Test environment

No fixtures. Every command writes under `/tmp/debaser-walkthrough`; delete that directory to undo everything. No network, no GitHub, no containers.

## Steps

### Step 1 of 7: Build a synthetic release behind the channel files (US1)

**Why this step:** Every channel reads the same four asset names and one `SHA256SUMS` file. Building that directory by hand shows the exact contract the rest of this journey consumes.

**Needs:** A checkout of this branch.

**Run:**

```bash
mkdir -p /tmp/debaser-walkthrough/assets
for target in linux-amd64 linux-arm64 darwin-arm64 darwin-amd64; do printf 'debaser 0.1.0 %s\n' "$target" > "/tmp/debaser-walkthrough/assets/debaser-0.1.0-$target"; done
(cd /tmp/debaser-walkthrough/assets && (command -v sha256sum >/dev/null && sha256sum debaser-0.1.0-* || shasum -a 256 debaser-0.1.0-*) > SHA256SUMS)
cat /tmp/debaser-walkthrough/assets/SHA256SUMS
```

**What you should see:** Four lines from `cat`, in glob order: `debaser-0.1.0-darwin-amd64`, `debaser-0.1.0-darwin-arm64`, `debaser-0.1.0-linux-amd64`, `debaser-0.1.0-linux-arm64`, one per line, each with a 64-hex digest, two spaces and the asset name.

**If you see something else:** A line with a single space or a path like `./debaser-...` means the checksum tool differs; `sha256sum -c` rejects that form, and the renderer will too.

**Result:**

### Step 2 of 7: Watch the license guard refuse to package this repository (US1)

**Why this step:** FR-019 says no package is published while the project records no license. This repository has none yet, so this is the guard doing its job, not a broken command.

**Needs:** Step 1's checksum directory.

**Run:**

```bash
bun scripts/release/render.ts --version 0.1.0 --sums /tmp/debaser-walkthrough/assets --out /tmp/debaser-walkthrough/refused
```

**What you should see:** Exit code 1 and one stderr line: `render: no license in package.json: package publication is refused (FR-019)`. Nothing is written to the output directory.

**If you see something else:** Rendering succeeded, which means a license is now recorded somewhere; that is the state the first package release needs.

**Result:**

### Step 3 of 7: Render all five package files from a licensed project (US2, US3)

**Why this step:** The same renderer produces the Homebrew formula, the RPM spec, the AUR files and the Debian metadata from one release. A temporary project carries the license so the repository itself stays untouched.

**Needs:** Steps 1 and 2, and the shell still in the repository root (the command uses `$OLDPWD` to find the script after changing directory).

**Run:**

```bash
mkdir -p /tmp/debaser-walkthrough/project
printf '{"name":"debaser-demo","version":"0.1.0","license":"Apache-2.0"}\n' > /tmp/debaser-walkthrough/project/package.json
printf 'Apache License 2.0\n' > /tmp/debaser-walkthrough/project/LICENSE
(cd /tmp/debaser-walkthrough/project && bun "$OLDPWD/scripts/release/render.ts" --version 0.1.0 --sums /tmp/debaser-walkthrough/assets --out /tmp/debaser-walkthrough/out)
ls -a /tmp/debaser-walkthrough/out
```

**What you should see:** Five `rendered ...` lines on stderr and then five files: `debaser.rb`, `PKGBUILD`, `.SRCINFO`, `debaser.spec`, `nfpm.yaml`.

**If you see something else:** `no checksum for ...` means the checksum directory is missing one of the four assets, which is the refusal FR-005 wants.

**Result:**

### Step 4 of 7: Check the Homebrew formula against the release (US2)

**Why this step:** The tap must serve the same bytes as the release for each platform, or Homebrew's checksum fails on install.

**Needs:** Step 3.

**Run:**

```bash
grep -E 'version |license |on_macos|on_linux|Hardware::CPU|url |sha256 |depends_on|system ' /tmp/debaser-walkthrough/out/debaser.rb
```

**What you should see:** `version "0.1.0"`, `license "Apache-2.0"`, macOS and Linux blocks split by `Hardware::CPU.arm?`, four `url` lines naming the four assets, four `sha256` values that also appear in `SHA256SUMS`, `depends_on "git"`, and a `system` line running `debaser --version`.

**If you see something else:** A `url` and `sha256` that disagree, or an `on_linux` block missing, would install the wrong binary on that platform; note which line, and this is a real defect.

**Result:**

### Step 5 of 7: Check the RPM and AUR metadata (US3)

**Why this step:** Fedora and Arch get a package that installs the release binary, declares the same `git` floor, and verifies the same checksums.

**Needs:** Step 3.

**Run:**

```bash
grep -E 'Requires:|License:|Version:|%ifarch|sha256sum|^pkgver|^pkgrel|^depends|^sha256sums_|^source_|options=' /tmp/debaser-walkthrough/out/debaser.spec /tmp/debaser-walkthrough/out/PKGBUILD
head -20 /tmp/debaser-walkthrough/out/.SRCINFO
```

**What you should see:** In the spec: `Version: 0.1.0`, the Apache license, `Requires: git >= 2.38`, architecture branches selecting the Linux asset, and a sha256 verification step. In the PKGBUILD: `pkgver=0.1.0`, `depends` including `git>=2.38`, one `source_` and one `sha256sums_` per architecture, and `options` that keep the binary unstripped. The `.SRCINFO` mirrors those fields.

**If you see something else:** A missing `x86_64` or `aarch64` source means one Fedora or Arch architecture would install the wrong asset.

**Result:**

### Step 6 of 7: Run the release rules and the typecheck (US1)

**Why this step:** Tag parsing, pre-release detection, asset naming, checksum lines, downgrade ordering, rendering and the guard are the rules that fail silently in CI if they are wrong.

**Needs:** Step 3 (the rendered files are not required, but the same toolchain is).

**Run:**

```bash
bun test scripts/release/
bun run typecheck
```

**What you should see:** `64 pass`, `0 fail` across four test files, then `tsc --noEmit` with no output and exit code 0.

**If you see something else:** A failing test names the rule that broke; read its title, which states the behavior in one sentence.

**Result:**

### Step 7 of 7: Exercise the compiled binary the way a release does (US1)

**Why this step:** The release publishes only a binary that ran on its own platform. This is the same check the build matrix runs, here on your machine.

**Needs:** Step 6, and a terminal (the smoke test uses `script` to give the binary a pseudo terminal for the live view).

**Run:**

```bash
bun run build
DEBASER_BINARY_PREBUILT=1 DEBASER_EXPECTED_VERSION=0.1.0 bun test tests/smoke/binary.test.ts
```

**What you should see:** The build writes `dist/debaser`, then `5 pass`, `0 fail`. The tests print the release version, run a live-view build under a pseudo terminal, and check that a warm start stays under 100 ms.

**If you see something else:** A version mismatch means the binary was built from a different `package.json` version than the tag under test, which is exactly what FR-002 refuses. A worker error in the live view is the risk issue #12 named.

**Result:**

## Not covered here

- **Publishing a release** needs the branch merged and a `v*` tag pushed; this worktree must not push, and the workflow is only runnable from the default branch.
- **The four-platform matrix** (`ubuntu-24.04`, `ubuntu-24.04-arm`, `macos-15`, `macos-15-intel`) needs GitHub's hosted runners, including the arm64 Linux runner.
- **The release guard's GitHub checks** (a `push` CI run for the tagged commit, containment in `origin/main`, no existing release) need `gh` against the real repository.
- **The five installs** need the channel repositories and secrets to exist: `rhuss/homebrew-tap`, the COPR project, the AUR account, `rhuss/debaser-apt` with its signing key, and mise, which reads the published assets.

## Coverage

- **US1** (release binaries): steps 1, 2, 6 and 7 cover naming, checksums, the license refusal, the rules and the platform check. Publication itself is not covered here.
- **US2** (Homebrew): step 4 covers the formula's per-platform bytes and metadata. The tap push and `brew install` are not covered.
- **US3** (Fedora, Arch, Debian/Ubuntu): steps 3 and 5 cover the RPM, AUR and Debian metadata. The COPR, AUR and apt pushes and real installs are not covered.
- **US4** (mise): not covered here; the mise definition is documentation against published assets.

## Results
