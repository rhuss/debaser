# Contract: Distribution channels

Each channel installs the release asset it names, declares the release version, and moves only forward.

## Common rules

- Started by the release workflow after publication (a release created with `GITHUB_TOKEN` does not emit `release: published`, so `release.yml` dispatches each channel), or run alone with a tag input. The `release: published` trigger stays for releases made by other actors. A pre-release triggers nothing.
- Reads the asset and its checksum from the release; never rebuilds.
- Publishes only a version newer than the one it currently serves. A retry of an older tag is a no-op.
- Holds one credential, as a repository secret, and never prints it.
- Failure leaves the release and every other channel untouched.

## Homebrew

Install:

```bash
brew install rhuss/tap/debaser
```

- Tap repository: `rhuss/homebrew-tap`, formula `Formula/debaser.rb`.
- Downloads the matching platform asset (macOS arm64/x64, Linux arm64/x64), verifies its SHA-256.
- `depends_on "git"`.
- `test do` runs `debaser --version`.
- Credential: a fine-grained token allowed to write the tap repository.

## Fedora (COPR)

Install:

```bash
sudo dnf copr enable rhuss/debaser
sudo dnf install debaser
```

- COPR project `rhuss/debaser`, built from a generated SRPM that installs the release binary under `/usr/bin`.
- Package metadata: version, license, summary, URL, `Requires: git >= 2.38`.
- Credential: a COPR API token in the maintainer's `~/.config/copr` format.

## Arch (AUR)

Install:

```bash
yay -S debaser-bin        # or another AUR helper
```

- Package `debaser-bin`, `source_x86_64` and `source_aarch64` pointing at the release assets, with matching `sha256sums_*`.
- `depends=('git>=2.38')`.
- `.SRCINFO` matches the PKGBUILD exactly.
- Credential: an SSH key registered with the maintainer's AUR account.

## Debian and Ubuntu (apt)

Install (after the one-time repository setup):

```bash
sudo install -d -m 0755 /usr/share/keyrings
curl -fsSL https://rhuss.github.io/debaser-apt/debaser-archive-keyring.gpg \
  | sudo gpg --dearmor -o /usr/share/keyrings/debaser.gpg
echo "deb [signed-by=/usr/share/keyrings/debaser.gpg] https://rhuss.github.io/debaser-apt stable main" \
  | sudo tee /etc/apt/sources.list.d/debaser.list
sudo apt update && sudo apt install debaser
```

- One `.deb` per architecture (`amd64`, `arm64`) built with nfpm from the release assets.
- Package metadata: version, license, homepage, `Depends: git (>= 2.38)`.
- Repository indexes are signed; the public key is published at the URL above.
- Credential: the signing key and its passphrase, as repository secrets.

## mise

Install an exact version, stable or pre-release, by configuring debaser as an `http` tool:

```toml
[tools."http:debaser"]
version = "<version>"
url = 'https://github.com/rhuss/debaser/releases/download/v{{ version }}/debaser-{{ version }}-{{ os(macos="darwin") }}-{{ arch(x64="amd64") }}'
bin = "debaser"
```

The URL is single-quoted because it contains double quotes. `os(macos="darwin")` and `arch(x64="amd64")` map mise's values onto the asset names, as mise's `http` backend documentation describes.

- Serves pre-releases by exact version; it is not a stable channel.
- No per-release automation and no credential.
- The README shows the four platform variants. The template variables and the `amd64`/`arm64` mapping are verified against mise's documentation while writing it.

## README

The install section lists Homebrew, the release binaries, Fedora, Arch, Debian/Ubuntu and mise, each with its command, the one-time setup where one exists, and the supported platforms and architectures.
