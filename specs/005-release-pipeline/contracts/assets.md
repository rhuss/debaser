# Contract: Release assets

## Tag

- Form: `v<semantic-version>`, for example `v0.1.0` or `v0.2.0-rc.1`.
- The version after `v` must equal `package.json`'s `version`. A mismatch refuses publication.
- A version containing a hyphen is a pre-release.

## Assets

Exactly four per release:

```text
debaser-<version>-linux-amd64
debaser-<version>-linux-arm64
debaser-<version>-darwin-arm64
debaser-<version>-darwin-amd64
SHA256SUMS
```

- `<version>` carries no leading `v`.
- Each binary is self-contained and runs with only `git` present.
- `debaser --version` prints `debaser <version>`.

## Checksums

`SHA256SUMS` has one line per asset, in `sha256sum -c` format:

```text
<hex>  debaser-<version>-linux-amd64
...
```

A user verifies with `sha256sum -c SHA256SUMS` after downloading the assets into one directory. The file covers all four binaries and contains no other entries.

## Immutability

- A published version's assets are never replaced, re-uploaded under the same name, or deleted.
- Publishing a version that already exists is refused.
- A moved or re-pushed tag does not republish; the existing release stands.
- A refused release is retried for the same tag without moving it, and publishes only when every check passes.

## Release kinds

- Stable tag: a normal release with generated notes.
- Pre-release tag: a pre-release entry with the same four assets and checksums. No stable channel updates.

## Platform check

Before publication, each binary passes, on a machine of its own platform:

1. `debaser --version` prints the release version.
2. A live-view build under a pseudo terminal completes with the view drawn and the final outcome line, with no worker error.
3. The run finishes within the job's timeout.

The tested file is the published file.
