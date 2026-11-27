# Feature Specification: Release pipeline and distribution channels

**Feature Branch**: `005-release-pipeline`

**Created**: 2026-11-27

**Status**: Draft

**Input**: User description: "brainstorm/06-release-pipeline.md: a tag-triggered release of macOS and Linux binaries with checksums, plus Homebrew, Fedora COPR, AUR, apt and mise channels"

## Clarifications

### Session 2026-11-27

- Q: Which tag shapes count as a pre-release? → A: A tag whose version carries a semantic-version pre-release suffix (a hyphen, e.g. `v1.2.3-rc.1`); a tag without one is stable.
- Q: Does a pre-release carry the same four platform binaries? → A: Yes. A pre-release publishes the same four artifacts and checksum file, marked pre-release, and updates no stable channel.
- Q: What if two releases run at the same time? → A: Each release publishes only artifacts built from its own tag; a release never mixes or waits on another.
- Q: Are published assets ever replaced or removed? → A: No. A published version's assets stay downloadable and unchanged, so pinned installs keep working.
- Q: Which license does the project declare? → A: Deferred to the maintainer. The pipeline must refuse package publication while the project declares none (FR-019); no license is chosen on the maintainer's behalf.

## User Scenarios & Testing *(mandatory)*

### User Story 1 - Install from a published release binary (Priority: P1)

A user on macOS or Linux, with no development toolchain, downloads the release binary for their platform, verifies it against the published checksums, and runs `debaser --version`. They never install a language runtime or build from source.

**Why this priority**: This is the base the README already promises and the prerequisite for every other channel. Without it, no channel has an artifact to distribute.

**Independent Test**: Push a tag, then on each of the four supported platforms download the asset, check it against the published checksum file, and run `debaser --version`. It reports the tagged version.

**Acceptance Scenarios**:

1. **Given** a `v1.2.3` tag on a commit whose tests passed, **When** the release finishes, **Then** four platform binaries and one checksum file are published, each binary reporting `1.2.3`.
2. **Given** the published checksum file, **When** a user verifies a downloaded binary, **Then** the checksum matches and the tool runs without any runtime dependency besides `git`.
3. **Given** a tag whose version differs from the version the tool reports, **When** the release is attempted, **Then** nothing is published and the mismatch is reported.
4. **Given** a tag on a commit whose automated tests failed, **When** the release is attempted, **Then** nothing is published.
5. **Given** any one of the four platforms fails to build or fails its platform check, **When** the release finishes, **Then** no release is published at all, rather than a release missing a platform.

---

### User Story 2 - Install with Homebrew (Priority: P2)

A macOS or Linux user installs debaser with `brew install rhuss/tap/debaser`, gets the binary matching the published release, and updates it with `brew upgrade`.

**Why this priority**: Homebrew reaches the widest developer audience, and issue #13 asks for it once release binaries exist.

**Independent Test**: On macOS arm64, macOS x64 and Linux, run the install command against the tap for the current release and confirm `debaser --version`, then confirm a formula update follows a new tag.

**Acceptance Scenarios**:

1. **Given** a published stable release, **When** a macOS user runs `brew install rhuss/tap/debaser`, **Then** the installed binary reports the release version and `brew test debaser` succeeds.
2. **Given** a published stable release, **When** a Linux user with Homebrew runs the same command, **Then** the matching Linux binary is installed.
3. **Given** a new stable tag, **When** the tap update completes, **Then** `brew upgrade` moves the user to the new version.
4. **Given** a pre-release tag, **When** the tap update runs, **Then** the tap keeps serving the last stable version.

---

### User Story 3 - Install from Linux distribution channels (Priority: P3)

A Fedora, Arch or Debian/Ubuntu user installs debaser through their own package manager (COPR, AUR, apt), receives the binary from the same release, and gets the same version all other channels serve.

**Why this priority**: The user explicitly asked for Linux packages such as Fedora. It depends on P1 and can be delivered channel by channel.

**Independent Test**: For each of the three channels, install the current release on that distribution and confirm `debaser --version` matches the release checksum and version.

**Acceptance Scenarios**:

1. **Given** a published stable release, **When** a Fedora user enables and installs the COPR package, **Then** the installed binary reports the release version.
2. **Given** a published stable release, **When** an Arch user installs the AUR package, **Then** the binary matches the published checksum.
3. **Given** a published stable release, **When** a Debian or Ubuntu user installs from the apt repository, **Then** the installed binary reports the release version.
4. **Given** the packages, **When** installed on a system without `git` 2.38 or newer, **Then** the package manager reports the missing or too-old dependency.

---

### User Story 4 - Install a specific version with mise, including pre-releases (Priority: P4)

A developer pins a debaser version in their tool configuration through mise, including a pre-release when they want to test one.

**Why this priority**: Lowest cost, since it consumes the release assets directly, and it gives pre-releases a way to reach early testers without touching the stable channels.

**Independent Test**: With mise configured for debaser, select the current stable version and one pre-release by exact version, and confirm `debaser --version` for each.

**Acceptance Scenarios**:

1. **Given** a published stable release, **When** a developer installs that exact version with mise, **Then** the binary reports that version.
2. **Given** a published pre-release, **When** a developer installs it by exact version, **Then** the binary reports the pre-release version and the stable channels still serve the last stable.

---

### Edge Cases

- A tag is pushed while an earlier release is still building: the later tag must not publish a release whose assets mix versions.
- A channel update fails after the release is published: the release stays available and the channel can be retried alone, without rebuilding the binaries.
- A channel retry runs after a newer release exists: the channel must not be downgraded.
- A pre-release tag arrives: binaries and a pre-release entry are published, and no stable channel moves.
- The checksum file is missing an asset, or an asset is missing from the release: publication is refused.
- A user on Windows, or on an architecture outside the four targets, finds no asset and a clear statement of what is supported.
- The project declares no license when a package is built: package publication is refused.
- The version reported by a cross-built binary does not match its tag: publication is refused before channels run.
- A tag is moved or pushed again after a release exists: the existing release for that version is not silently replaced.
- A tag does not carry a well-formed version: publication is refused before any build.

## Requirements *(mandatory)*

### Functional Requirements

- **FR-001**: A release MUST be triggered by pushing a tag of the form `v<version>`. No other action may be required to release.
- **FR-002**: The project MUST declare its version in exactly one place, and the system MUST refuse to publish when the tag version differs from the version the tool reports at runtime.
- **FR-003**: The system MUST refuse to publish when the tagged commit's automated tests did not pass.
- **FR-004**: The system MUST produce binaries for Linux amd64, Linux arm64, macOS arm64 and macOS amd64.
- **FR-005**: The system MUST publish a checksum file covering every binary, in a form a user can verify offline.
- **FR-006**: Every binary MUST be exercised on a machine of its own platform before publication: it reports its version and completes a short live-view run in a scratch repository, with no view or worker error.
- **FR-007**: A release MUST be published only when all four platform builds and platform checks passed. A partial release is not acceptable.
- **FR-008**: Assets MUST follow one stable naming scheme, `debaser-<version>-<os>-<arch>`, where `<version>` has no leading `v`, `<os>` is `linux` or `darwin`, and `<arch>` is `amd64` or `arm64`, so package definitions can address them without consulting a person.
- **FR-009**: A stable tag (a version with no pre-release suffix) MUST publish a normal release with generated release notes. A pre-release tag (a version with a hyphen and a pre-release suffix, e.g. `v1.2.3-rc.1`) MUST publish a pre-release entry with the same four platform binaries and checksum file, and MUST NOT update any stable channel.
- **FR-010**: The Homebrew channel MUST install the matching platform binary from a tap, verify its checksum, declare the `git` dependency, and pass a version check on install.
- **FR-011**: The Fedora channel MUST be installable from a COPR repository and install the release binary without building from source.
- **FR-012**: The Arch channel MUST be installable from AUR and verify the published checksum.
- **FR-013**: The Debian/Ubuntu channel MUST be installable from a signed apt repository, with one package per supported architecture.
- **FR-014**: The mise channel MUST let a user install an exact version, stable or pre-release, from the release assets.
- **FR-015**: Every channel MUST install a binary byte-identical to the published release asset it names (identically for the installed file, including inside a package payload), and MUST declare the release version in its package metadata.
- **FR-016**: Every package MUST declare `git` 2.38 or newer as a dependency.
- **FR-017**: A failure in one channel MUST NOT block, roll back or invalidate the release, and MUST NOT affect other channels. Each channel MUST be retryable on its own.
- **FR-018**: A channel retry MUST NOT downgrade a channel that already serves a newer version.
- **FR-019**: Package publication MUST be refused when the project declares no license.
- **FR-020**: The README install section MUST list each supported channel with its install command and state which platforms and architectures are supported.
- **FR-021**: Releases MUST be independent of each other: a release publishes only artifacts built from its own tag, and never waits for, mixes with or overwrites another release's artifacts.
- **FR-022**: A published version's assets MUST remain downloadable and unchanged, so pinned installs and older packages keep resolving.

### Key Entities

- **Release**: a version, the commit it was built from, its four platform artifacts, its checksum file, and whether it is stable or pre-release.
- **Artifact**: one platform's binary for one release, with its asset name and checksum, and the platform check result that allowed its publication.
- **Channel**: a distribution path (release assets, Homebrew tap, Fedora COPR, Arch AUR, apt repository, mise registry), with the version it currently serves and the record of the release that put it there.
- **Package**: a channel-specific form of one artifact, carrying the release version, checksum and dependency metadata.

## Success Criteria *(mandatory)*

### Measurable Outcomes

- **SC-001**: On each of the four supported platforms, a user installs the current release with one documented command and sees the tagged version in `debaser --version`, with no runtime besides `git`.
- **SC-002**: From tag push to binaries available on the release page: under 20 minutes.
- **SC-003**: Across the first ten releases, no release reports a version other than its tag (zero occurrences).
- **SC-004**: Across the first ten releases, no published binary fails its own platform check (zero occurrences).
- **SC-005**: After a channel failure, re-running that channel alone restores it without any rebuild of the platform binaries.
- **SC-006**: Over any ten consecutive stable releases, every channel serves either the newest stable version or the previous one, never older, and never a version no release lists.
- **SC-007**: Every install command in the README succeeds on a machine that has never had a build toolchain installed.

## Assumptions

- Third-party channels only. Official Fedora and Debian archives are out of scope, because they require source builds and the language runtime is not packaged there.
- Windows, and architectures other than amd64 and arm64, are out of scope for this feature.
- All channel packages carry the same binaries produced by the release, rather than building from source in each channel.
- The first release uses the version currently declared by the project (`0.1.0`), and later versions follow ordinary semantic versioning.
- The project adopts a license as part of this feature; which license is the maintainer's choice and is recorded before the first package is published.
- Users come to the project through GitHub releases, the README, and their platform's package manager, and each has network access to the channel.
- An existing automated test suite already gates the default branch; this feature reuses that result rather than adding a second gate.
- Release notes are generated from the changes in the release; no manually maintained changelog is part of this feature.
