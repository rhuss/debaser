import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import type { Snapshot } from "../git/snapshot";
import type { Usage } from "../plugins/harness/types";
import type { AcceptanceCheck } from "./patchlist";
import type { Source } from "../plugins/sources/types";
import type { Timing } from "../timings/timings";
import { paths } from "./paths";

export type Phase = "rebase" | "merge" | "verify" | "accept" | "report" | "rollback";
/** A patch merged into the build, as the report and the harness prompts name it. */
export type BuildPatch = { source: string; commit: string; description: string };
/** A patch as the run fetched it: what to merge and how it was resolved. */
export type Planned = {
  source: Source;
  display: string;
  description: string;
  /** The commit to merge, or null for a patch skipped before merging. */
  commit: string | null;
  ref: string;
  prLink: string | null;
  prBody?: string;
  prState?: "OPEN" | "MERGED" | "CLOSED";
  pin?: string;
  acceptance?: AcceptanceCheck;
  skip: "merged" | "contained" | null;
  /** Its merge commit on the integration branch, once merged. */
  merge?: string | null;
};
export type Event = { kind: string; patch?: string; step?: string; detail?: string };
/** A merge that conflicted, and who resolved it. */
export type Conflict = { patch: string; files: string[]; by: "user" | "harness" | "rerere" | null };
export type Attribution = { kind: "build-drift" | "build-clash"; patch: string; others: string[] };
/** A fix commit on top of the merges; `log` keeps the failing output it answered. */
export type Fix = {
  step: string;
  commit: string;
  by: "agent" | "user";
  files: string[];
  log?: string;
  /** Set for an acceptance fix: the patch whose check it answered. */
  acceptance?: string;
  attribution?: Attribution[];
};
/** The failing step (or acceptance check) a run stopped at, and the patches it
 * points at, worked out once for the tree at `head`. */
export type StopFailure = { step: string; acceptance?: string; head: string; log: string; attribution: Attribution[] };
export type HarnessTask = "conflict" | "check" | "acceptance" | "rebase-conflict" | "rebase-check";
export type HarnessCall = {
  kind: "conflict" | "check" | "acceptance";
  patch?: string;
  step?: string;
  attempt: number;
  head: string;
  snapshot: Snapshot;
  files?: string[];
  log?: string;
};
/** One finished harness call, for the report and the live view. */
export type HarnessUse = {
  call: number;
  kind: HarnessTask;
  patch?: string;
  step?: string;
  branch?: string;
  attempt: number;
  ok: boolean;
  reason?: string;
  seconds: number;
  usage: Usage | null;
};
export type AcceptanceResult = {
  patch: string;
  result: "pass" | "fail" | "flaky" | "none" | "skipped" | "fixed";
  log?: string;
  exit?: number;
};
/** What happened to one own patch branch in a rebase phase or run. */
export type RebaseResult = {
  patch: string;
  branch: string;
  from: string;
  to: string | null;
  lease: string;
  outcome: "rebased" | "current" | "skipped" | "failed";
  how?: "clean" | "rerere" | "harness" | "user";
  reason?: string;
  step?: string;
  log?: string;
  fixes?: string[];
  flaky?: { step: string; log: string }[];
  pending?: boolean;
  worktree?: string;
  rebasableThere?: boolean;
  diverged?: boolean;
  created?: boolean;
  push?: "pushed" | "refused" | null;
  pushDetail?: string;
};
export type RebaseTarget = {
  patch: string;
  branch: string;
  from: string;
  lease: string;
  local: string | null;
  conflicts: boolean;
  worktree?: string;
  pending?: boolean;
};
export type RebaseStop = { target: RebaseTarget; worktree: string; commit: string; files: string[]; problem?: string };

export type RunState = {
  kind: "build" | "rebase";
  startedAt: string;
  reportDir: string;
  startTip: string | null;
  /** HEAD of the checkout before the run, for the install trigger and a first-run rollback. */
  startHead: string;
  startBranch: string | null;
  /** The saved copy of the installed artifact at run start (`work/artifact.start`), or null. */
  startArtifact: string | null;
  upstream: { ref: string; tip: string };
  phase: Phase;
  cursor: number;
  step: string | null;
  attempts: number;
  /** Harness calls made, numbering the prompt files. */
  calls: number;
  plan: Planned[];
  merged: BuildPatch[];
  events: Event[];
  conflicts: Conflict[];
  fixes: Fix[];
  acceptance: AcceptanceResult[];
  /** Index of the acceptance check in progress, while in phase `accept`. */
  acceptCursor?: number;
  /** Harness tries per failing acceptance check, kept across reruns until it passes (FR-021). */
  acceptAttempts?: Record<string, number>;
  stopped: { code: number; snapshot: Snapshot } | null;
  stopFailure?: StopFailure | null;
  push: boolean;
  harnessCall?: HarnessCall | null;
  harnessUsage?: HarnessUse[];
  timing?: Timing;
  rebased?: RebaseResult[];
  rebaseTargets?: RebaseTarget[];
  rebaseCursor?: number;
  rebaseStop?: RebaseStop | null;
};

function writeJSON(path: string, value: unknown) {
  const temporary = `${path}.tmp-${process.pid}`;
  writeFileSync(temporary, JSON.stringify(value, null, 2) + "\n");
  renameSync(temporary, path);
}
export function loadRun(dir: string): RunState | null {
  const path = paths.run(dir);
  if (!existsSync(path)) return null;
  const run = JSON.parse(readFileSync(path, "utf8")) as RunState;
  // Older or cut-short state: fill what later code reads.
  run.events ??= [];
  run.conflicts ??= [];
  run.fixes ??= [];
  run.merged ??= [];
  run.plan ??= [];
  run.acceptance ??= [];
  // Versions before the rename called a build "rebuild".
  if ((run.kind as string) === "rebuild") run.kind = "build";
  run.kind ??= "build";
  return run;
}
export function saveRun(dir: string, run: RunState): void {
  mkdirSync(dir, { recursive: true });
  writeJSON(paths.run(dir), run);
}
export function clearRun(dir: string): void {
  rmSync(paths.run(dir), { force: true });
}
export { writeJSON };
