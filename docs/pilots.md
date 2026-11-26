# Pilot validation (after merge)

Three success criteria need real forks, network access and weeks of use. They
are checked by hand after the merge, not in CI. Record each result in the
pull request that closes the pilot.

## SC-009: unattended builds of both pilots

### rtk-ai/rtk

1. Fork `rtk-ai/rtk`, clone the fork, and add the upstream remote:

   ```bash
   git clone git@github.com:<you>/rtk.git && cd rtk
   git remote add upstream https://github.com/rtk-ai/rtk.git
   git fetch upstream
   ```

2. Add the four-patch set (two upstream PRs and two own branches pushed to the
   fork):

   ```bash
   debaser add 2569
   debaser add 4891
   debaser add <own-branch-1> "first own change"
   debaser add <own-branch-2> "second own change"
   ```

3. Run an unattended build:

   ```bash
   debaser build --trust-recipe --json > build.json; echo "exit=$?"
   ../rtk-debaser/dist/rtk-custom --version
   ```

   Expected: exit 0 (or exit 2 to 6 with a stop that names its cause),
   `dist/rtk-custom` runs, and `result.json` lists every patch as merged or
   skipped with a reason.

### tals/corgi

1. In a corgi checkout with `upstream` pointing at `tals/corgi` and `origin` at
   your fork, add the patches from the old tool's patch list by hand
   (`debaser add <source> "<description>"` per entry).
2. Run `debaser build`.

   Expected: the build runs in `../corgi-debaser`, the checkout you started
   it from stays as it was, `../corgi-debaser/dist/corgi-custom` runs, and
   the after-build reload fires.

## SC-012: status speed on the rtk pilot

```bash
time debaser status
```

Expected: under 10 seconds without `--fetch`, with one row per patch and the
upstream drift since the last build. `git status` and `git for-each-ref`
print the same before and after.

## SC-011: interventions over a month

1. Before switching, record a two-week baseline with the old tool: count the
   runs that stopped and needed a person (conflicts, failing steps, harness
   give-ups) from its reports.
2. Switch to debaser and run `debaser build` daily (cron or by hand) for a
   month.
3. Count the stopped runs:

   ```bash
   dir=$(git rev-parse --git-common-dir)/debaser
   jq -r 'select(.outcome == "stopped") | .report' "$dir"/reports/*/result.json | wc -l
   ```

   debaser keeps the ten newest run reports, so copy `result.json` files out
   daily (for example `cp -n "$dir"/reports/*/result.json ~/debaser-results/`)
   and count over the copies.

   Expected: no more stops per day than in the baseline.
