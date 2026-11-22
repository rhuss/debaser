# Agent harnesses

debaser can hand merge conflicts, failing checks, failing acceptance checks
and own-branch rebases to an AI agent. It always checks the agent's result
itself before accepting it, and every accepted change becomes its own commit
(`Resolved-By: harness` on a merge, `Fixed-By: harness` on a fix).

## Configuration

The harness lives in the `harness` section of `patches.json`:

```json
"harness": {
  "command": ["claude", "-p", "Follow the instructions in {prompt_file}", "--allowedTools", "Read,Edit,Bash(bun test:*)"],
  "kind": "claude",
  "timeoutSeconds": 900,
  "attempts": 3,
  "tasks": {
    "rebase": { "command": ["codex", "exec", "--sandbox", "workspace-write", "Follow the instructions in {prompt_file}"], "kind": "codex" }
  }
}
```

- `command` is the command you write, with `{prompt_file}` standing for the
  prompt file debaser writes. The prompt path is also in `DEBASER_PROMPT`,
  and `DEBASER_TASK` names the task (`conflict`, `check`, `acceptance`,
  `rebase-conflict`, `rebase-check`). Standard input is closed.
- `kind` picks the adapter: `claude`, `codex`, `pi`, `opencode` or `plain`
  (the default). The adapter adds only the flags that turn on the agent's
  event stream; it never adds or translates permission flags (FR-025). The
  log keeps readable text, the raw stream is kept as `prompts/NN-<task>.jsonl`,
  and token counts go into the report. `plain` logs the output as it comes
  and records tokens as unknown.
- `timeoutSeconds` (default 900) ends the harness and every process it
  started. `attempts` (default 3) bounds the tries per problem; the whole run
  stops with exit code 5 once the harness has made attempts × (steps +
  acceptance checks) fixes and a step still fails.
- `tasks` names a different harness per task (`conflict`, `check`,
  `acceptance`, `rebase`); each falls back to the top-level command.

A harness command that is not executable is a warning, and the run behaves
as without a harness (exit 2 at a conflict, 3 at a failing check). A harness
that runs but exits non-zero without an acceptable result (for example an
expired login) uses up its attempts at once: the run stops with exit 5,
naming its exit code and last output line, and `debaser continue` asks it
again.

## Safe example commands

debaser adds streaming flags only. Grant each agent what it needs and no more.

### claude

```json
{ "command": ["claude", "-p", "Follow the instructions in {prompt_file}", "--allowedTools", "Read,Edit,Grep,Glob,Bash(bun test:*),Bash(bunx tsc:*)"], "kind": "claude" }
```

debaser adds `--output-format stream-json --verbose`. Put the prompt before
`--allowedTools`: that option takes several values, so a prompt after it is read
as one more tool name and claude gets no prompt ("Input must be provided either
through stdin or as a prompt argument").

### codex

```json
{ "command": ["codex", "exec", "--sandbox", "workspace-write", "--skip-git-repo-check", "Follow the instructions in {prompt_file}"], "kind": "codex" }
```

debaser adds `--json` after `exec`.

### pi

```json
{ "command": ["pi", "-p", "--tools", "read,edit,bash", "@{prompt_file}"], "kind": "pi" }
```

debaser adds `--mode json`. pi reads standard input when it is a pipe; debaser
closes it, so pi takes the prompt from the file.

### opencode

```json
{ "command": ["opencode", "run", "--auto", "--agent", "debaser-fixer", "Follow the instructions in {prompt_file}"], "kind": "opencode" }
```

debaser adds `--format json`. Unattended runs need `--auto`, which you put in
the command; define the `debaser-fixer` agent with the tools and permissions
you allow.

### Any other command

```json
{ "command": ["./scripts/my-agent.sh", "{prompt_file}"] }
```

Its output is logged line by line; tokens are unknown.

## What debaser accepts

- **Conflicts**: no conflict markers left, only the conflicted files changed,
  nothing committed by the agent. Files resolved by recorded resolutions
  (rerere) stay resolved and staged across attempts.
- **Fixes**: something changed. A commit the agent made is undone with its
  changes kept, and debaser commits them as `debaser: fix <step> (agent)`.
  Every step then runs again from the first.
- A rejected attempt is undone to the state before it and retried from there.
- Fixes on the integration branch are never carried into the next build;
  the patches they point at get handoff prompts in the report instead.
