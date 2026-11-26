# CLI Contract: ordering commands

## add

```
debaser add <source> [description] [--pin <sha>] [--upstream owner/repo] [--after <patch> | --before <patch>]
```

- Without `--after`/`--before`: unchanged (appends, prints `added <shown>: <description>`).
- With one of them: inserts at that place, prints `added <shown>: <description>` and then the numbered list with the new row marked. Exit 0.
- Both options: usage error, exit 1. Invalid reference: exit 1, nothing added.
- With a position option while run state exists or the lock is held: exit 1, nothing added.

## move

```
debaser move <patch> --after <patch>
debaser move <patch> --before <patch>
debaser move
debaser move --propose [--fetch] [--yes]
```

`<patch>`: a bare number (position as in `list`'s `#` column) or any source spelling `remove` accepts (`#12` is PR 12).

| Situation | Output | Exit |
|---|---|---|
| order changed | numbered list, moved rows marked | 0 |
| order unchanged by the move | `the order is unchanged` | 0 |
| fewer than two patches | `nothing to reorder` | 0 |
| relative to itself; both/neither of `--after`/`--before` with a reference; `--propose` with a reference or placement; `--yes`/`--fetch` without `--propose` | usage error | 1 |
| plain `move` without a terminal | usage error naming `move <patch> --after|--before <patch>` and `move --propose` | 1 |
| run state exists | `a run is stopped ...; finish it with debaser continue or end it with debaser rollback` | 1 |
| lock held by a live process | existing lock refusal naming the command | 1 |

### Interactive

```
<numbered list>
Move which patch? (1-N, Enter to finish) 4
To which position? (1-N) 1
<numbered list, moved row marked>
Move another patch? [y/N] n
```

Invalid answers repeat the question with the valid range. End of input: exit 1, nothing saved. Signal: exit 129/130/143, nothing saved. The order is saved once at the end if it changed.

### Proposal

```
merge order proposal (merge conflicts only; checks were not run)

  CURRENT                 PROPOSED
  1 acme/widget#12        1 acme/widget#12
  2 my-branch             2 acme/widget#15
  3 acme/widget#15        3 my-branch

  moved:
    #2 my-branch after #3 acme/widget#15: both change src/x.ts; my-branch is your branch

  conflicts no order avoids (the next build hands them to the harness):
    my-branch and acme/widget#15: src/x.ts

  conflicts: current order 1, proposed order 1

Apply this order? [y/N]
```

- Also lists `conflicts with upstream alone` and skipped patches when present.
- Same order: `the current order is already the best order found`, no question, exit 0.
- More conflicts in the proposal: says the current order is kept, no question, exit 0.
- Without a terminal: proposal printed, `run debaser move --propose --yes to apply it`, exit 0. `--yes` applies.
- Apply: saves, prints the marked list and `next: debaser build`. Exit 0. Decline: exit 0, nothing saved.
- Unfetched commits: exit 1 naming the patches (or upstream), hint `--fetch`.

## build

At start, when the merge order changed since the last successful build:

```
debaser: note: the merge order changed since the last successful build; recorded conflict resolutions may not apply
```
