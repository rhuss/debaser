import { join } from "node:path";
import type { Context } from "../core/context";
import type { RunState } from "../core/runstate";
import type { Outcome } from "../cli/outcome";
import { end } from "../live/events";
import { resultOf } from "../report/report";
import * as timings from "../timings/timings";
import { ms, signal } from "./common";

/** Ends a run: the outcome carries the machine-readable result (FR-049), and
 * the live view gets the run's end. */
export function endRun(ctx: Context, run: RunState, outcome: Outcome): Outcome {
  const report = run.reportDir ? join(run.reportDir, "report.md") : null,
    result = run.reportDir ? resultOf(run.reportDir) : undefined;
  if (run.timing) timings.tick(run, ms(ctx));
  signal(ctx, end(outcome, report, run.timing?.activeMs));
  return { ...outcome, report, ...(result !== undefined ? { result } : {}) };
}
