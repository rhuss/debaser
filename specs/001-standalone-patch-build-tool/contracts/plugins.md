# Contract: plugin interfaces

The core depends only on these interfaces. Each plugin kind has a registry (`src/plugins/<kind>/registry.ts`) mapping a name to an implementation. Adding an agent, parser or source kind is one new module plus one registry line (SC-006).

## Patch source

```ts
interface SourceKind<S extends Source> {
  kind: S["kind"];
  parse(text: string, ctx: ParseContext): S | null;        // add argument -> source
  display(s: S): string;                                     // "owner/repo#12", "me:branch"
  slug(s: S): string;                                        // file-name safe
  privateRef(s: S): string | null;                           // refs/debaser/... (null for own branches)
  fetch(s: S, ctx: FetchContext): FetchedPatch;              // resolves the commit to merge, PR state
  headRepository(s: S, ctx: FetchContext): string | null;   // for ownership (FR-032)
  link(s: S): string | null;                                 // PR or tree URL
}
interface FetchedPatch { commit: string; pr?: { state: "OPEN" | "MERGED" | "CLOSED"; title: string; mergeCommit?: string; url: string; body?: string }; notes: string[] }
```

v1 kinds: `branch`, `pr`, `fork-branch`, all GitHub (FR-004). `ParseContext` carries the upstream repository for bare PR numbers.

## Recipe resolver

```ts
function resolveRecipe(ctx: { checkout: string; upstream: UpstreamRef; patchList: PatchList; dir: string; trust: TrustStore; trustFlag: boolean }): EffectiveRecipe;
// throws Explained (exit 1) for: no generic match, several generic matches, untrusted repo recipe off a terminal without --trust-recipe
```

## Failure parser

```ts
interface FailureParser {
  name: string;                         // "bun-test" | "tsc" | "cargo-test"
  parse(log: string, root: string): ParsedFailure;
}
interface ParsedFailure {
  failedFiles: string[];                // repo-relative
  failedTests: string[];
  implicatedPaths: string[];            // used by attribution (FR-027)
  summary: string;                      // one line for stops and reports
  narrowedArgs?: string[];              // value for {tests} on the flaky rerun; absent = rerun in full
}
```

A step without a parser uses the generic log scan for `implicatedPaths` and reruns in full.

## Harness adapter

```ts
interface HarnessAdapter {
  kind: "claude" | "codex" | "pi" | "opencode" | "plain";
  args(command: string[]): string[];            // adds streaming flags only (FR-017)
  parser(): StreamParser;
}
interface StreamParser {
  feed(chunk: string): { text: string[]; activity: string[] };   // buffered by "\n"
  usage(): { input: number; output: number } | null;              // null = unknown (plain)
  failed(): string | null;                                          // in-stream failure reason (pi stopReason, opencode error)
}
```

Spawning, timeouts, process-group kill, logs (`NN-<task>.log` readable, `.jsonl` raw) and verification live in the core (`src/harness/`), shared by all adapters.

## Harness verification (core)

```ts
function acceptConflict(ctx, call: { files: string[]; head: string; snapshot: Snapshot }): Verdict;  // FR-019, FR-035a
function acceptFix(ctx, call: { head: string; snapshot: Snapshot }): Verdict;                       // FR-020, FR-029, FR-031a
type Verdict = { ok: true; files: string[] } | { ok: false; reason: string; broken: boolean };
```

`broken` (non-zero exit without an acceptable result) uses up the remaining attempts at once and ends with exit 5.

## Acceptance check runner

```ts
function runAcceptance(ctx, patch: Patch, check: AcceptanceCheck, env: Record<string, string>): { result: "pass" | "fail"; log: string; exit: number; matched: boolean | null };
```

Pass = exit equals `check.exit` and (no `match` or the regex matches the combined output). Timeout = fail.

## Live view events

Ported unchanged in shape from the reference (`begin`, `stage`, `item`, `retry`, `harness`, `log`, `estimate`, `end`), with one new stage `accept` between `verify` and `after-build`. `Sink = (e: LiveEvent) => void`; a throwing sink never stops the run.
