# Quickstart: Validating the release pipeline

Everything below runs without publishing anything except where marked. The release workflows only run on a tag or on demand, so most checks are local.

## Prerequisites

- Bun 1.4.4, `git`, and the repository checked out.
- `gh` authenticated for the read-only checks.
- Optional for packaging checks: `nfpm`, `rpmbuild`, `dpkg-deb`, `gpg` (install what is available).

## 1. Release rules and templates (no network)

```bash
bun test scripts/release/version.test.ts scripts/release/render.test.ts
```

Covers tag parsing, the pre-release rule, asset names, the downgrade comparison, and that each template renders with the version and four checksums and contains no placeholders.

## 2. Platform check on this machine

```bash
bun run build
DEBASER_BINARY_PREBUILT=1 bun test tests/smoke/binary.test.ts
```

Expect: version output, a live-view build under a pseudo terminal, and a warm start under 100 ms. The binary that passes is the one the workflow would publish.

## 3. Template rendering

```bash
bun scripts/release/render.ts --version 0.1.0 --sums <dir-with-sha256sums> --out /tmp/packaging
```

Expect `debaser.rb`, `PKGBUILD`, `.SRCINFO`, `debaser.spec` and `nfpm.yaml`, each carrying version `0.1.0`, the four asset names in the checksum file, and the license placeholder resolved from the project's license.

## 4. Debian package locally (Linux)

```bash
nfpm package --config /tmp/packaging/nfpm.yaml --packager deb --target /tmp/packages/
dpkg-deb --info /tmp/packages/debaser_0.1.0_amd64.deb
dpkg-deb --contents /tmp/packages/debaser_0.1.0_amd64.deb | grep usr/bin/debaser
```

Expect one package per architecture, with the binary under `/usr/bin/debaser` and `git (>= 2.38)` in Depends.

## 5. RPM spec locally (Fedora container or host with rpmbuild)

```bash
rpmbuild -ba /tmp/packaging/debaser.spec
rpm -qp --requires ~/rpmbuild/RPMS/*/debaser-0.1.0-*.rpm | grep git
```

The spec fetches the asset named for the build architecture; without network, use a local `Source0`.

## 6. Dry run of the release workflow (no tag)

```bash
gh workflow run release.yml -f dry_run=true -f tag=v0.1.0
gh run watch
```

Expect: the guard accepts the version match and the commit's green CI run, all four platform jobs build and pass their checks, and the run stops before creating a release. `dry_run=false` is the only path that publishes, and it is used by a real tag.

## 7. Channel retry

```bash
gh workflow run channel-aur.yml -f tag=v0.1.0
```

Expect: the job renders the package, sees that AUR already serves `0.1.0`, and exits without pushing a downgrade.

## 8. Real installation (after a real release)

```bash
brew install rhuss/tap/debaser && debaser --version
```

and, on Fedora, Arch and Debian/Ubuntu, the commands in [contracts/channels.md](./contracts/channels.md). This is the only step that needs a published release.
