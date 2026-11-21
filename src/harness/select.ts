import { accessSync, constants } from "node:fs";
import { isAbsolute, resolve } from "node:path";
import type { Context } from "../core/context";
import { listOf } from "../core/context";
import type { HarnessConfig } from "../core/patchlist";

export type Task = "conflict" | "check" | "acceptance" | "rebase";
/** A harness ready to run for one task: its command, adapter kind and limits. */
export type Harness = { command: string[]; kind: string; timeoutSeconds: number; attempts: number };

/** The configured harness for a task (FR-023): the task's own, else the
 * top-level one; null without any. Limits always come from the top level. */
export function configured(h: HarnessConfig | undefined, task: Task): Harness | null {
  if (!h) return null;
  const own = h.tasks?.[task];
  return {
    command: own?.command ?? h.command,
    kind: own?.kind ?? (own ? "plain" : (h.kind ?? "plain")),
    timeoutSeconds: h.timeoutSeconds ?? 900,
    attempts: h.attempts ?? 3,
  };
}
/** The harness executable, or null when it can't be run. */
export function executable(command: string[], repo: string, env: Record<string, string | undefined>): string | null {
  const exe = command[0];
  if (!exe) return null;
  if (exe.includes("/")) {
    const path = isAbsolute(exe) ? exe : resolve(repo, exe);
    try {
      accessSync(path, constants.X_OK);
      return path;
    } catch {
      return null;
    }
  }
  return Bun.which(exe, { PATH: env.PATH ?? "" });
}
const warned = new WeakMap<Context, Set<string>>();
/** The harness for `task` when it can run; one that isn't executable is a
 * warning (once per command) and counts as none (FR-013). */
export function harnessFor(ctx: Context, task: Task): Harness | null {
  const h = configured(listOf(ctx).harness, task);
  if (!h) return null;
  if (executable(h.command, ctx.repo, ctx.env)) return h;
  const seen = warned.get(ctx) ?? new Set<string>();
  warned.set(ctx, seen);
  if (!seen.has(h.command[0])) {
    seen.add(h.command[0]);
    ctx.progress(`warning: harness ${h.command[0]} is not executable; continuing without it`);
  }
  return null;
}
