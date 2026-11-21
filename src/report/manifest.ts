import { mkdirSync, writeFileSync } from "node:fs";
import type { Context } from "../core/context";
import { listOf } from "../core/context";
import { paths } from "../core/paths";
import type { RunState } from "../core/runstate";
import * as git from "../git/git";
import { pushUrl } from "../git/remotes";

export type BuildManifest = {
  version: 1;
  upstream: { repo: string; branch: string; tip: string };
  commit: string;
  fork: string | null;
  patches: { source: unknown; display: string; commit: string; pin?: string }[];
};

/** The build's identity (FR-045): what a project can stamp into its build. */
export function manifestOf(ctx: Context, run: RunState, commit: string): BuildManifest {
  const list = listOf(ctx);
  return {
    version: 1,
    upstream: { repo: list.upstream.repo, branch: list.upstream.branch, tip: run.upstream.tip },
    commit,
    fork: git.hasRemote(ctx.repo, "origin") ? withoutCredentials(pushUrl(ctx.repo, "origin")) : null,
    patches: run.plan
      .filter(p => !p.skip && p.merge)
      .map(p => ({ source: p.source, display: p.display, commit: p.commit!, ...(p.pin ? { pin: p.pin } : {}) })),
  };
}
/** A URL with any user name and password dropped, so a token in origin's
 * push URL never reaches a build stamp; scp-style `user@host:path` is kept. */
export function withoutCredentials(url: string | null): string | null {
  if (!url || !/^[a-z][a-z0-9+.-]*:\/\//i.test(url)) return url;
  try {
    const u = new URL(url);
    if (!u.username && !u.password) return url;
    u.username = "";
    u.password = "";
    return u.toString();
  } catch {
    return url;
  }
}
/** Writes `manifest.json` and returns the environment steps get (FR-045). */
export function writeManifest(ctx: Context, run: RunState, commit: string): Record<string, string> {
  const m = manifestOf(ctx, run, commit),
    path = paths.manifest(ctx.dir);
  mkdirSync(ctx.dir, { recursive: true });
  writeFileSync(path, JSON.stringify(m, null, 2) + "\n");
  return manifestEnv(m, path);
}
export function manifestEnv(m: BuildManifest, path: string): Record<string, string> {
  return {
    DEBASER_PATCHES: JSON.stringify(m.patches),
    DEBASER_FORK_URL: m.fork ?? "",
    DEBASER_COMMIT: m.commit,
    DEBASER_MANIFEST: path,
  };
}
/** The step environment for `tree`, its commit standing in for the integration commit. */
export function stepEnv(ctx: Context, run: RunState, tree: string): Record<string, string | undefined> {
  const m = manifestOf(ctx, run, git.head(tree));
  return { ...ctx.env, ...manifestEnv(m, paths.manifest(ctx.dir)) };
}
