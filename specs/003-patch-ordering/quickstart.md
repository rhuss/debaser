# Quickstart: validating patch ordering

Prerequisites: a clone with `upstream` and `origin` remotes, `bun install`, `bun run build`, and `dist/debaser` on `PATH`. Automated equivalents live in `tests/integration/order.test.ts`; run `bun test tests/integration/order.test.ts` and `bun test src/core/order.test.ts`.

## 1. Insert at a place

```bash
debaser add 101; debaser add 102; debaser add 103
debaser add 104 --after 1      # list shows 101, >104, 102, 103
debaser add 105 --before '#101'  # 105 is now #1
debaser add 106 --after 1 --before 2   # usage error, exit 1
```

## 2. Move from the command line

```bash
debaser move 4 --after 1
debaser move my-branch --before 1
debaser move 2 --after 2      # usage error
```

Check `debaser list` after each.

## 3. Interactive

```bash
debaser move                  # answer 3, 1, then n; list printed after the move
debaser move </dev/null       # no terminal: usage hint, exit 1
```

## 4. Proposal

Set up two patches where B was branched from A and lists B before A, plus an own branch and a PR that change the same lines, own branch first.

```bash
git rev-parse --all | sort > /tmp/refs-before
debaser move --propose        # A before B; own branch after the PR; one unavoidable conflict
git rev-parse --all | sort | diff - /tmp/refs-before   # no output
git -C ../<checkout>-debaser status --porcelain        # unchanged
debaser move --propose --yes  # applies; prints next: debaser build
```

## 5. Guards and the build note

```bash
debaser build                 # stops at a conflict
debaser move 1 --after 2      # refused: a run is stopped
debaser rollback
debaser move 1 --after 2
debaser build                 # prints the "merge order changed" note once
```
