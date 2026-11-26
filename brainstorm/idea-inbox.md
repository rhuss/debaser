# Idea Inbox

Ideas captured from code reviews for future brainstorming.

### structured-recipe-layer-sources

- **Source**: deep-review
- **Date**: 2026-11-23
- **Reference**: 002-build-worktree
- **Summary**: `debaser recipe` recovers each layer's source by parsing the layer id (`repo:<path>@<sha7>`); the resolver could attach a structured source to each layer instead.

> A change to the id format would silently turn repository layers into "built-in" (src/views/recipe.ts, src/recipes/trust.ts).

### named-config-info-type

- **Source**: deep-review
- **Date**: 2026-11-23
- **Reference**: 002-build-worktree
- **Summary**: The configuration display's input type is `ReturnType<typeof configInfo>` in the view; a named `ConfigInfo` type in core would give the data model's shape a home.

> Views elsewhere import named types from core (src/views/config.ts).

### trust-flags-outside-paths

- **Source**: deep-review
- **Date**: 2026-11-23
- **Reference**: 002-build-worktree
- **Summary**: Absolute `artifact.install`/`artifact.output` paths are allowed for trusted repository recipes too; `debaser trust` and `debaser recipe` could point out paths outside the build directory.

> Not wider than before (`../` already escaped and steps run arbitrary commands), but worth making visible at the trust prompt.

### lighter-list-inspection

- **Source**: deep-review
- **Date**: 2026-11-23
- **Reference**: 002-build-worktree
- **Summary**: `list` now spawns about eight git processes, including a `git status` of the build directory, though it only needs paths and "not created yet".

> The modified-file state is a `status` concern; `inspect(ctx, { state: false })` could skip it for `list`.

### first-build-checkout-feedback

- **Source**: deep-review
- **Date**: 2026-11-23
- **Reference**: 002-build-worktree
- **Summary**: The first build's `git worktree add --quiet` (a full checkout, then a fresh install) shows only one progress line, and the disk cost is undocumented.

> On large repositories the build looks hung, which invites Ctrl-C at the slowest step.

### build-refusal-ordering

- **Source**: deep-review
- **Date**: 2026-11-23
- **Reference**: 002-build-worktree
- **Summary**: The build creates the build directory before fetching and before the headless trust refusal, so those failures can leave a new (valid, reused) directory behind, contrary to a code comment.

> Either tighten the comment or move the directory-independent work before `prepare()` (src/run/build.ts).

### install-stamp-upgrade-note

- **Source**: deep-review
- **Date**: 2026-11-23
- **Reference**: 002-build-worktree
- **Summary**: Existing build directories and in-place checkouts with a recipe without an install marker install once after upgrading, because they have no install stamp yet.

> One-time cost; worth a release-note line.

### proposal-reasons-in-view

- **Source**: deep-review
- **Date**: 2026-11-26
- **Reference**: 003-patch-ordering
- **Summary**: `core/order.ts` builds the proposal's reason sentences itself; returning the constraints and rendering them in `views/propose.ts` would keep core free of wording.

> Wording or styling changes to reasons currently have to be made in the pure core module, unlike every other part of the proposal.

### perf-test-by-default

- **Source**: deep-review
- **Date**: 2026-11-26
- **Reference**: 003-patch-ordering
- **Summary**: The SC-004 timing test runs only with `DEBASER_PERF`; a scheduled run or a cheap merge-count check would guard it by default.

> A slowdown in the proposal's merge testing would go unnoticed in the normal test run.
