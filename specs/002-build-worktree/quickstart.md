# Quickstart: validating the build directory

Prerequisites: `bun install`, then `bun run build` (binary at `dist/debaser`). The scenarios use a scratch project with an `upstream` remote and two patches, as in `specs/001-standalone-patch-build-tool/quickstart.md`. Automated versions live in `tests/integration/tree.test.ts` and `tests/integration/config.test.ts`.

## 1. Build without touching the checkout (US1)

```bash
cd project && git switch -c my-feature && echo x >> README.md   # dirty, on a feature branch
debaser build; echo "exit=$?"
git branch --show-current; git status --short
ls ../project-debaser; git -C ../project-debaser branch --show-current
jq .tree .git/debaser/patches.json
```

Expected: `exit=0`. The checkout is still on `my-feature` with ` M README.md`. `../project-debaser` exists on `debaser`, with the build output. The patch list has `"tree": "../project-debaser"`.

## 2. Same result from anywhere (US1-3)

Run `debaser build` from `../project-debaser`, then from a third worktree. Expected: both succeed and leave the same `debaser` tip for unchanged upstream and patches.

## 3. Stop, continue, rollback (US2)

Make two patches conflict, then run `debaser build`. Expected: exit 2, and the message and `fix-conflict.md` name `../project-debaser`. Resolve the conflict there, run `debaser continue` from `project/`, and expect exit 0. Repeat the stop and run `debaser rollback` from `project/`. Expected: `debaser` is back at the previous build, and `project/` is unchanged.

## 4. Configuration display (US3)

```bash
debaser list | head -2; debaser status | head -2; debaser recipe | head -1
debaser status --json | jq .config
```

Expected: the patch list path, the local recipe (or `none`), the build directory, and the layer sources (`built-in`, a `repo … at upstream <sha>` layer, `local <path>`).

## 5. Migration (US4)

With an existing `debaser` branch checked out in `project/` (old behavior), `debaser build` refuses with the "main checkout has debaser checked out" message. After `git switch main`, the build creates `../project-debaser` from the existing branch, and `debaser rollback` still returns to `debaser-prev`.

## 6. In place (US5)

Set `"tree": "."` in the patch list, then run `debaser build` in a clean checkout. Expected: it builds in place as before (the checkout ends on `debaser`).

## 7. Refusals

- Edit a tracked file in `../project-debaser`, then run `debaser build`: exit 1, listing the file.
- `git -C ../project-debaser switch -c other`, then `debaser build`: exit 1 ("has other checked out").
- `rm -rf ../project-debaser`, then `debaser build`: it is recreated and says so.
