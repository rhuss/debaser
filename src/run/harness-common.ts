import type { Context } from "../core/context";
import type { HarnessUse, RunState } from "../core/runstate";
import type { Stage } from "../live/events";
import { outcome, type Verdict } from "../harness/verify";
import type { Usage } from "../plugins/harness/types";
import * as timings from "../timings/timings";
import { signal } from "./common";

/** Keeps a finished harness call in the run state, for `continue` and the report. */
export function recordUse(_ctx: Context, run: RunState, use: HarnessUse) {
  (run.harnessUsage ??= []).push(use);
  // A rejected call, like one that failed to start, says nothing about how long a fix takes.
  if (use.ok) timings.harnessCall(run, use.seconds * 1000);
}
/** Sends a harness call's end, and a rejected one as a retry. */
export function harnessEnd(ctx: Context, call: { stage: Stage; id: string; attempt: number; limit: number }, usage: Usage | null, verdict: Verdict) {
  signal(ctx, { t: "harness", state: "end", ...call, usage, ...outcome(verdict) });
  if (!verdict.ok) signal(ctx, { t: "retry", stage: call.stage, id: call.id, why: "harness", detail: verdict.reason });
}
/** An `onActivity` that sends the harness's lines as live events; it never throws. */
export function activity(ctx: Context, call: { stage: Stage; id: string; attempt: number; limit: number }) {
  if (!ctx.sink) return undefined;
  return (line: string) => signal(ctx, { t: "harness", state: "activity", ...call, text: line });
}
/** A harness call that failed to run: why, and its log. */
export type Broken = { reason: string; log: string };
