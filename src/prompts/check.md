# Fix a failing step in a patched {{project}} build

debaser rebuilt this checkout (the current directory) from upstream plus a
list of patches, and a check now fails on it. The same check passes on plain
upstream, so the failure comes from the patches or from how they combine. All
merges are committed.

- Step: {{step}}
- Command: `{{command}}`
- What fails: {{failing}}
- Cause: {{cause}}
- Attempt: {{attempt}}
- Build directory: {{tree}}

Patches merged in this run:

{{patches}}

The end of the step's output (the full log is {{log}}):

```text
{{logExcerpt}}
```

## What to do

Find why the step fails and change only what is needed to make it pass. Run
the command above to check your fix. Prefer the smallest change that keeps
every patch's intent; this fix applies to this build only, and the patches'
authors get handoffs for the lasting fix.

## Rules

- Leave your changes in the working tree. Do not commit, amend or rebase.
- Do not edit any patch branch.
- {{finish}}
