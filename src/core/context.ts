import type { Sink } from "../live/events";
import { signal as send, type LiveEvent } from "../live/events";
import type { EffectiveRecipe } from "../recipes/types";
import { Explained } from "./errors";
import { hasRemote } from "../git/git";
import type { PatchList } from "./patchlist";

/** What every command runs with: the checkout, debaser's directory, the patch
 * list, the effective recipe once resolved, and the ways it talks to the user. */
export type Context = {
  repo: string;
  dir: string;
  /** The patch list; null before the first `add`. */
  list: PatchList | null;
  env: Record<string, string | undefined>;
  now: () => Date;
  /** A plain progress line (`debaser: <line>` on stderr). */
  progress: (line: string) => void;
  /** Child output, echoed as it comes. */
  echo: (chunk: Uint8Array) => void;
  /** Asks a question on a terminal; absent or null without one. */
  ask?: (question: string) => string | null;
  color?: boolean;
  columns?: number;
  /** Receives the live events; a sink that throws never stops the run. */
  sink?: Sink;
  /** Receives `rollback`'s tasks as they start and end, for its checklist on a terminal. */
  task?: (id: string, state: "running" | "done" | "skipped" | "failed", detail?: string) => void;
  recipe?: EffectiveRecipe;
  /** `--trust-recipe`: a headless run may use an untrusted project-repo recipe. */
  trustRecipe?: boolean;
};

/** Sends a live event, swallowing sink exceptions. */
export const signal = (ctx: Context, e: LiveEvent) => send(ctx.sink, e);

export function listOf(ctx: Context): PatchList {
  if (!ctx.list)
    throw new Explained("there is no patch list yet; add a patch first with `debaser add <source>`");
  return ctx.list;
}
/** The remote upstream is fetched from: the patch list's, else `origin` when
 * there is no `upstream` remote (origin may fetch upstream and push to the fork). */
export function upstreamRemote(ctx: Context): string {
  const name = listOf(ctx).upstream.remote;
  if (hasRemote(ctx.repo, name)) return name;
  return name === "upstream" && hasRemote(ctx.repo, "origin") ? "origin" : name;
}
export function recipeOf(ctx: Context): EffectiveRecipe {
  if (!ctx.recipe) throw Error("the recipe is not resolved yet");
  return ctx.recipe;
}
