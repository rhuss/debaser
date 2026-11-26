/** Whether the merge order changed since the last successful build (FR-024):
 * recorded conflict resolutions were made for that order. */
import type { Context } from "../core/context";
import { listOf } from "../core/context";
import { paths } from "../core/paths";
import { sourceKey } from "../plugins/sources/parse";
import { lastBuildResult, resultKeys } from "./report";

/** The `sourceKey`s of the patches the newest successful build merged, in
 * merge order; null when no kept report records one. */
export function lastBuildOrder(ctx: Context): string[] | null {
  const result = lastBuildResult(paths.reports(ctx.dir), r => r.outcome === "success");
  return result ? resultKeys(result, "merged") : null;
}
/** Whether the live patches that the last successful build merged are now in
 * another order; patches added or retired since don't count by themselves. */
export function orderChanged(ctx: Context): boolean {
  const last = lastBuildOrder(ctx);
  if (!last) return false;
  const live = listOf(ctx).patches.map(p => sourceKey(p.source)),
    now = live.filter(key => last.includes(key)),
    was = last.filter(key => live.includes(key));
  return now.some((key, i) => key !== was[i]);
}
