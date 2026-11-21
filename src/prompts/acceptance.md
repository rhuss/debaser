# Make a patch's acceptance check pass in a patched {{project}} build

debaser rebuilt this checkout (the current directory) from upstream plus a
list of patches. Every project-wide check passes, but the acceptance check of
one patch fails: the build no longer does what that patch is for.

- Patch: {{patch}}
- Description: {{description}}
- Pull request: {{prLink}}
- Check: `{{command}}`
- Expected: {{expected}}
- Build output: {{artifact}}
- Attempt: {{attempt}}

The check's output:

```text
{{logExcerpt}}
```

## What to do

Find why the check fails and change only what is needed for this patch to do
what it is for again. Prefer the smallest change that keeps every patch's
intent. Build the project and run the check above to verify your fix.

## Rules

- Leave your changes in the working tree. Do not commit, amend or rebase;
  debaser commits your change as a separate fix commit, reruns every check
  and rebuilds.
- Do not edit any patch branch.
- When you are done, stop. Say briefly what was wrong and what you changed.
