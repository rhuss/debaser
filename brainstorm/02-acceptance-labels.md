# Acceptance labels: mark patches with a check, not those without

Date: 2026-11-23
Status: approved

## Why

Most patches have no patch-specific acceptance check. Labelling all of them "unverified" adds noise and reads like a warning. Mark only the patches that have a check.

## Goals

- `list`: append `(with check)` to the description of a patch with an acceptance check; no mark for a patch without one.
- `status`: the ACCEPTANCE column shows `-` for a patch without a check; drop the hint "unverified: patches without an acceptance check."
- Build summary: drop the `unverified: … (no acceptance check)` line.
- `report.md`: leave patches without a check out of "Acceptance checks"; omit the section when no patch has a check.
- `result.json`: the acceptance value `"unverified"` becomes `"none"`.
- Update spec (FR-030 and acceptance scenario), data model, contracts, quickstart and README wording to match.

## Non-goals

- How acceptance checks run, their blame, harness fixes, or exit codes.
- The live build view: it already says "no acceptance check" in dim text and stays as is.

## Approaches

1. **Static marker in `list`** (picked): `(with check)` whenever the patch has an acceptance entry. Simple, no dependency on past runs.
2. **Last build's result in `list`**: `(verified)` only when the last check passed, `(check failed)` otherwise. Dropped: `list` would need to read the last run, and the user preferred a plain marker.

## Left to the builder

- Internal type rename (`"unverified"` to `"none"` in `src/core/runstate.ts` and dependents) and test updates.
- Exact placement of `-` in the status table (same as other empty cells there).
