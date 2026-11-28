# Data Model: Release pipeline

The pipeline persists no application data. The entities below describe the values that cross boundaries between the release, the channel workflows and the packaging templates. Their canonical form is the release manifest derived from the tag and `package.json`.

## Release

| Field | Type | Rules |
|-------|------|-------|
| `version` | string | Semantic version, no leading `v`. Must equal `package.json`'s `version` (FR-002). |
| `tag` | string | `v` + `version`. Must be well formed; anything else is refused before build. |
| `commit` | SHA | The tagged commit. A CI run for this exact SHA must have concluded successfully (FR-003). |
| `prerelease` | boolean | True when `version` contains a hyphen (semantic-version pre-release). |
| `assets` | Artifact list | Exactly four, one per target. |
| `checksums` | file | `SHA256SUMS`, one line per asset, `sha256sum -c` compatible (FR-005). |
| `notes` | generated text | Release notes generated from the changes in the release. |

**State transitions**: `validated` → `built` (all four targets passed) → `published`. A failure in `built` returns to nothing published (FR-007). `published` is terminal: assets are never replaced or removed (FR-022).

## Artifact

| Field | Type | Rules |
|-------|------|-------|
| `target` | enum | `linux-amd64`, `linux-arm64`, `darwin-arm64`, `darwin-amd64`. |
| `name` | string | `debaser-<version>-<os>-<arch>`, no leading `v`; `<os>` is `linux` or `darwin`; `<arch>` is `amd64` or `arm64` (FR-008). |
| `sha256` | hex string | Computed after the platform check passes; listed in `SHA256SUMS`. |
| `check` | result | The platform check (version output plus pty live-view run) that allowed publication (FR-006). |

**Validation**: an artifact exists in a release only if its platform check passed. Four artifacts or no release.

## Channel

| Field | Type | Rules |
|-------|------|-------|
| `id` | enum | `homebrew`, `copr`, `aur`, `apt`, `mise`. |
| `stable` | boolean | True for `homebrew`, `copr`, `aur`, `apt`; false for `mise` (serves pre-releases by exact version). |
| `served_version` | string | The version the channel currently serves. Must never move backwards (FR-018). |
| `served_release` | tag | The release that put `served_version` there, for traceability. |
| `credential` | secret name | One per channel, held as a repository secret. |
| `retryable` | boolean | Always true: a channel job runs alone through `workflow_dispatch` (FR-017). |

**State transitions**: `idle` → `updating` → `served`, or `updating` → `failed` → `retryable`. A `failed` channel never changes the release state.

## Package

| Field | Type | Rules |
|-------|------|-------|
| `format` | enum | `formula`, `rpm-spec`, `pkgbuild`, `deb`, `mise-tool`. |
| `version` | string | Same as the release version (FR-015). |
| `source_asset` | asset name | Exactly the artifact the package installs. |
| `checksum` | hex string | The artifact's checksum in `SHA256SUMS`; package formats that carry checksums must match it (FR-015). |
| `dependencies` | list | `git >= 2.38` where the format supports versions; `git` for the formula; none for mise (FR-016). |
| `license` | string | Required. Publication is refused while the project records none (FR-019). |

## Relationships

- One Release has four Artifacts.
- One Channel points at the Release it last published.
- One Package derives from one Artifact of one Release.
- A Release can be referenced by any Channel that is not `stable` (mise); stable Channels reference only stable Releases (SC-008).
