# Research: debaser v1

Phase 0 of the plan. Each entry records a decision, why, and what else was considered. Sources: a spike compiled on this machine (Bun 1.4.4, macOS, git 2.56), the reference implementation (`corgi/.claude/worktrees/custom-build-tool/scripts/custom_build/`, frozen tals/corgi#117), and the installed agent CLIs (pi 1.5.2, opencode 2.3.0) with their source.

## R1. Single binary with `bun build --compile`

- **Decision**: Ship one binary built with `bun build --compile src/cli/main.ts src/live/worker.ts --outfile dist/debaser`. Prompt templates and built-in recipes are embedded with `import x from "./file" with { type: "text" }`.
- **Rationale**: The spike compiled a main module plus a `Worker` entry. The worker ran from the binary in any working directory, and `Bun.TOML.parse` worked inside it. Binary size is 85 MB. Warm startup is 40 ms; the first launch after a build takes about 1 s while macOS scans it, once.
- **Alternatives**: Go or Rust rewrite (small binary, but discards the reference's test approach and contradicts the owner constraint). A `bunx` script (needs Bun installed, breaks FR-051).

## R2. Live view worker

- **Decision**: Keep the reference design: a Bun `Worker` draws the view, because the core runs git synchronously and blocks the main thread. They talk through `postMessage` events plus a small `SharedArrayBuffer` (terminal lock, "asked" slot for prompts, "stopped" slot). An `inline` mode draws on the main thread for tests.
- **Rationale**: Validated by R1. The design is proven in #117; FR-046 needs plain output identical with and without the view, which the reducer/renderer split (pure `state` and `render`) makes testable.
- **Alternatives**: Async git with a main-thread renderer (a large rewrite of every git call, more interleaving bugs).

## R3. File formats

- **Decision**: Recipes are TOML read with `Bun.TOML.parse` (read only, never written). The patch list is JSON written atomically (tmp file plus rename) with a `version` field. Run state, timings and the trust store are JSON.
- **Rationale**: Clarified in the spec. Bun has no TOML writer, and `add`/`remove` must round-trip the patch list losslessly.
- **Alternatives**: YAML (Bun parses it too, but whitespace errors in hand edits), TOML for both (needs a third-party writer, breaks the no-dependency goal).

## R4. Where debaser keeps its files

- **Decision**: `<git-common-dir>/debaser/` by default, overridable by `--dir` then `DEBASER_DIR`. Layout mirrors the reference's `.custom-build/` (see data-model.md). Throwaway worktrees go to `<dir>/work/`.
- **Rationale**: Outside the working tree, so resets never touch it and the reference's `info/exclude` workaround disappears. Shared by worktrees of the checkout. The self-copy into `work/tool/` goes away because the binary is installed elsewhere.
- **Alternatives**: XDG data dir keyed by repository (rejected in clarification), in-tree ignored directory (needs exclude handling).

## R5. Process model and git access

- **Decision**: Keep the reference's synchronous `Bun.spawnSync` git wrapper with an interrupt check (a child killed by SIGINT/SIGTERM/SIGHUP makes debaser exit 130/143/129). Minimum git version 2.38 (`merge-tree --write-tree`, used for merge checks without touching the tree). `rerere.enabled=true`, `rerere.autoUpdate=true` are passed with `-c` on merges and rebases.
- **Rationale**: Proven behavior; the contract suite pins it.
- **Alternatives**: isomorphic-git or libgit2 bindings (dependencies, incomplete rerere and worktree support).

## R6. Harness adapters

All adapters share one interface (contracts/plugins.md): add streaming flags, feed raw chunks, return readable text lines, activity lines and token usage, and judge whether the stream ended in a failure.

| Adapter | Flags added | Text | Activity | Tokens | Failure signal | Caveats |
|---|---|---|---|---|---|---|
| claude | `--output-format stream-json --verbose` | `assistant` events, `message.content[]` items with `type:"text"` | `tool_use` items: `name` plus `input.file_path`, `command` or `pattern` | `result.usage`: input = `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`, output = `output_tokens` | exit code | none |
| codex | `--json` (after `exec` when present) | `item.*` with `item.type == "agent_message"` | `command_execution` (`command`), `file_change` (`changes[0].path`); each `item.id` once | `turn.completed.usage`: `input_tokens` (includes cached), `output_tokens` | exit code | none |
| pi | `--mode json` | `message_end` with `message.role == "assistant"`, `content[]` items `type:"text"` | `tool_execution_start`: `toolName` plus `args.command`, `args.path` or `args.pattern` | sum `message_end.message.usage` of assistant messages only: input = `input + cacheRead + cacheWrite`, output = `output` | exit code, plus last assistant `stopReason` in `error`, `aborted` or `length` | must be spawned with stdin closed (it reads stdin when it is a pipe); split on `\n` only; `agent_settled` is the real end |
| opencode | `--format json` | `text` events, `part.text` (whole blocks) | `tool_use` events: `part.tool` plus `part.state.input.command`, `path` or `pattern` | sum `step_finish.part.tokens`: input = `input + cache.read + cache.write`, output = `output + reasoning` | exit code 1 plus an `error` event | unattended runs need `--auto`, which the user puts in their command (debaser does not add permission flags, FR-025); docs show it |
| plain | none | every line | none | unknown | exit code | none |

- **Decision**: The prompt goes to the harness both as a file path substituted for `{prompt_file}` in the command and as `DEBASER_PROMPT` in the environment. Stdin is closed for every adapter (fixes pi; the reference also piped the prompt on stdin, which claude and codex do not need when the prompt file is named in the command, and `plain` commands read the file). Process group via `detached: true`; kill with `process.kill(-pid, "SIGKILL")` on timeout, normal end and signals.
- **Rationale**: One spawn path for all agents; the pi stdin hang is the only adapter-specific spawn rule and closing stdin is harmless for the others.
- **Alternatives**: Prompt on stdin for all (hangs pi when combined with an argument; opencode appends it).

## R7. Failure parsers

- **Decision**: Parsers return `{failedFiles, failedTests, implicatedPaths, summary, narrowedArgs?}`. `narrowedArgs` lets the flaky rerun run only failing test files (the reference's `failedAgain`). v1 ships `bun-test`, `tsc` (both ported from `steps.ts`) and `cargo-test` (new: reads `---- <test> stdout ----` blocks, `panicked at <file>:<line>`, and compiler `--> <file>:<line>` locations; no narrowing, cargo filters by test name, not file). Without a parser, implicated paths come from the generic log scan (paths named outside lines that hold nothing but a path, FR-027).
- **Rationale**: Keeps the core language-free (Open Thread from the brainstorm).

## R8. Recipe model

- **Decision**: TOML with `extends`, `[install]`, `[artifact]`, `[[steps]]`, `[prompts]`, `after_build`. Steps merge by name with `before`/`after` placement and `steps_replace = true` (FR-039a). Built-in recipes are embedded files `src/recipes/builtin/*.toml`; project recipes are keyed by `owner/repo`. Project-repo recipe path: `.debaser/recipe.toml`, read from the fetched upstream tip with `git show <upstream>:.debaser/recipe.toml`. Trust store `<dir>/trust.json` maps repository to a SHA-256 of the recipe content. Local override: `<dir>/recipe.toml`.
- **Placeholders** in step and acceptance commands: `{output}` (the build output path for the tree the step runs in), `{tests}` (failing test files on a narrowed rerun; expands to nothing on a full run), `{root}` (tree root). The build output of isolated runs lives in their own worktree, so baseline and rebase checks never overwrite the installed artifact (FR-008a).
- **Generic detection**: `bun-ts` matches `bun.lock` or `bun.lockb`; `rust-cargo` matches `Cargo.toml`.

## R9. Testing approach

- **Decision**: `bun test`. Unit tests next to the pure modules (`src/**/*.test.ts`), integration tests in `tests/integration/` against a "test world" ported from the reference: bare repos under a temp `github/` directory served through `DEBASER_GITHUB=file://...`, a seed repo, a clone with `upstream` and `origin`, a fake `gh` shell script fed by JSON files, stub steps (`true`, a grep for `BROKEN`, and a build that writes the merge list to `{output}`), and stub harness scripts. The CLI runs in-process through `main(argv, io)`. A small set of smoke tests run the compiled binary.
- **Behavior contract**: `docs/behavior-contract.md` lists each of the reference suite's tests (141 `test(` calls in the frozen copy) with status `carried` (and the debaser test name) or `dropped` (with reason). A test (`tests/contract.test.ts`) fails if a listed debaser test name does not exist.
- **Rationale**: Reusing the test world is the cheapest way to keep "the spirit" of the 3,200-line suite (approach B's main risk).

## R10. Names

- **Decision**: Refs under `refs/debaser/` (`pull/`, `heads/`, `rebase-backup/`, `rebased/`, `rebase-lease/`, `rebase-checking/`, `fork/`). Integration branch `debaser`, backup `debaser-prev`. Commit messages `Merge <source>: <description>` (trailer `Resolved-By: harness`), `debaser: fix <step> (agent)` (trailer `Fixed-By: harness`), `debaser: fix <step> (user)`, `debaser: fix acceptance <patch> (agent)`. Environment: `DEBASER_DIR`, `DEBASER_GITHUB`, `DEBASER_TASK` and `DEBASER_PROMPT` (for the harness), `DEBASER_PATCHES`, `DEBASER_FORK_URL`, `DEBASER_COMMIT`, `DEBASER_MANIFEST`, `DEBASER_ARTIFACT`, `DEBASER_TEST_DEBUG`.

## R11. Pilot recipes

- **rtk-ai/rtk** extends `rust-cargo`: steps `fmt` (`cargo fmt --check`), `clippy` (`cargo clippy --all-targets -- -D warnings`), `test` (`cargo test`, parser `cargo-test`), `build` (`cargo build --release`); output `target/release/rtk`; install path `dist/rtk-custom`; install step `fetch` (`cargo fetch --locked`) triggered by `Cargo.lock`, `Cargo.toml`.
- **tals/corgi** extends `bun-ts`: adds `native` (`bun build.ts --native-only`) before `test`; build `bun build.ts --outfile {output}`; output `dist/corgi-debaser`; install path `dist/corgi-custom`; after-build `["./dist/corgi-custom", "reload"]`; typecheck `bun typecheck.ts`.
- **bun-ts**: `install` (`bun install --frozen-lockfile`, triggers `bun.lock`, `package.json`, marker `node_modules`), `typecheck` (`bunx tsc --noEmit`, parser `tsc`), `test` (`bun test {tests}`, parser `bun-test`). No build step and no artifact by default.
- **rust-cargo**: `fetch` (install), `test` (`cargo test`, parser `cargo-test`), `build` (`cargo build --release`), artifact unset (the project recipe names it).

## R12. Concurrency lock

- **Decision**: `<dir>/lock` created with `O_EXCL`, holding `{pid, command, startedAt}`. A lock whose pid is not alive (`process.kill(pid, 0)` throws `ESRCH`) is taken over. `status`, `list` and `recipe` take no lock.
