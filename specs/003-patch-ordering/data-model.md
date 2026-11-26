# Data Model: Managing the order of patches

The patch list file does not change shape: the order is the order of `patches` in `patches.json`. The types below are in-memory only.

## PatchRef

How a user names a live patch (FR-001, FR-002).

| Field | Type | Notes |
|---|---|---|
| kind | `"position"` \| `"source"` | `/^\d+$/` is a position; anything else is parsed as a source |
| position | number | 1-based; valid 1..patches.length |
| source | Source | parsed with `parse(arg, upstream.repo)`, matched with `sameSource` |

Resolution returns the 0-based index or throws `Explained` ("position N is out of range 1..M", "<shown> is not in the list").

## Placement

`{ after: PatchRef } | { before: PatchRef }` on the command line; once resolved, the `At` type of plan.md "Interfaces" (`{ after: number } | { before: number }`, 0-based). Applied after removing the moved patch: `after` → index(ref)+1, `before` → index(ref). Moving a patch relative to itself is a usage error. Interactive moves use the final position instead (`moveTo(patches, from, to)`).

## PairResult

| Field | Type | Notes |
|---|---|---|
| a, b | number | current indices, a < b |
| ab | boolean | A then B merges cleanly on upstream |
| ba | boolean | B then A merges cleanly on upstream |
| files | string[] | conflicting files of the failing direction(s), deduplicated |

## Participant

| Field | Type | Notes |
|---|---|---|
| index | number | current 0-based index |
| own | boolean | source kind `branch` |
| commit | string | the commit tested |

Fixed patches (not participants): `{ index, why: "skipped" | "upstream", files? }`.

## Constraint

`{ first: number; then: number; rule: 1 | 2; files: string[] }`; accepted or dropped (cycle).

## Proposal

| Field | Type | Notes |
|---|---|---|
| current | number[] | current indices in order (identity) |
| proposed | number[] | indices in proposed order |
| reasons | string[] | one per accepted constraint violated by the current order |
| unavoidable | { a, b, files }[] | pairs conflicting both ways, plus dropped constraints |
| upstream | { index, files }[] | patches that conflict with upstream alone |
| skipped | number[] | contained or merged upstream |
| counts | { current: number; proposed: number } | verified conflict counts (FR-016) |
| kept | boolean | true when the proposal was rejected because it had more conflicts |

State transitions: computed → shown → applied (saved) or declined (nothing written).
