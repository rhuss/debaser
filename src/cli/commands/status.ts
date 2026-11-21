import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { Context } from "../../core/context";
import { listOf, upstreamRemote } from "../../core/context";
import { paths } from "../../core/paths";
import * as runstate from "../../core/runstate";
import type { RebaseResult } from "../../core/runstate";
import * as git from "../../git";
import { prInfo } from "../../github/gh";
import { display, privateRef } from "../../plugins/sources/parse";
import { select } from "../../rebase/select";
import { pushCommand } from "../../rebase/push";
import { reportDirs } from "../../report/report";
import { whereStopped } from "../../run/where";
import { patchLink } from "../../views/list";
import * as view from "../../views/status";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

/** Where each patch was last fetched to, without fetching. */
function knownRefs(ctx: Context): { display: string; ref: string | null }[] {
  return listOf(ctx).patches.map(p => {
    const s = p.source,
      shown = display(s);
    if (p.pin) return { display: shown, ref: p.pin };
    if (s.kind !== "branch") return { display: shown, ref: privateRef(s) };
    if (git.revParse(ctx.repo, `refs/heads/${s.name}`)) return { display: shown, ref: `refs/heads/${s.name}` };
    return { display: shown, ref: `refs/remotes/origin/${s.name}` };
  });
}
function ownState(r: RebaseResult): view.Own {
  if (r.pending) return { kind: "pending", command: pushCommand(r) };
  if (r.outcome === "current") return { kind: "current", ...(r.reason ? { reason: r.reason } : {}) };
  if (r.worktree) return { kind: "worktree", path: r.worktree, rebasableThere: !!r.rebasableThere };
  if (r.diverged) return { kind: "diverged" };
  return { kind: "other", reason: r.reason ?? r.outcome };
}
type LastResult = { command?: string; patches?: { display: string; checks?: string; acceptance?: string }[] };
/** The newest rebuild's result.json, if any: a `rebase` run since then moves
 * `latest` but has no check or acceptance results to show. */
function lastResult(ctx: Context): LastResult | null {
  const reports = paths.reports(ctx.dir);
  for (const name of reportDirs(reports).reverse()) {
    const path = join(reports, name, "result.json");
    try {
      if (!existsSync(path)) continue;
      const result = JSON.parse(readFileSync(path, "utf8")) as LastResult;
      if (result.command === "rebuild") return result;
    } catch {}
  }
  return null;
}

/** `debaser status` (FR-036, FR-037): read only, no lock, no fetch unless `--fetch`. */
export async function run(ctx: Context, o: Options, io: IO): Promise<Outcome> {
  const list = listOf(ctx),
    remote = upstreamRemote(ctx),
    name = `${remote}/${list.upstream.branch}`;
  if (o.fetch) {
    const failed = git.fetch(ctx.repo, remote, `+refs/heads/${list.upstream.branch}:refs/remotes/${name}`);
    if (failed) ctx.progress(`warning: cannot fetch ${name}: ${failed}`);
  }
  const run = runstate.loadRun(ctx.dir),
    upstream = git.revParse(ctx.repo, `refs/remotes/${name}`),
    built = git.revParse(ctx.repo, `refs/heads/${list.branch}`),
    last = lastResult(ctx),
    v: view.View = {
      run: run ? { ...whereStopped(run), startedAt: run.startedAt, report: run.reportDir } : null,
      upstream: { name, tip: upstream },
      rows: [],
      note: null,
      home: ctx.env.HOME,
    };
  if (upstream) {
    // Own branches: read the remote state git records (FR-037), never fetching.
    const own = select(
        { repo: ctx.repo, config: list, env: ctx.env, upstream, upstreamRemote: remote },
        list.rebase ?? "all",
        { skip: new Set(), fetch: false },
      ),
      owns = new Map<string, view.Own>(),
      tips = new Map<string, string>();
    for (const t of own.targets) {
      owns.set(t.patch, { kind: "behind", conflicts: t.conflicts });
      tips.set(t.patch, t.from);
    }
    for (const r of own.results) {
      owns.set(r.patch, ownState(r));
      const at = r.to ?? r.from;
      if (at) tips.set(r.patch, at);
    }
    const fork = ctx.color && git.hasRemote(ctx.repo, "origin") ? git.remoteTarget(ctx.repo, "origin", "push") : null;
    // Upstream commits since the last build: from where the integration branch meets upstream.
    const since = built ? git.git(ctx.repo, ["merge-base", built, upstream]).stdout.trim() : "";
    v.sinceBuild = since ? Number(git.git(ctx.repo, ["rev-list", "--count", "--no-merges", `${since}..${upstream}`]).stdout.trim()) || 0 : null;
    v.rows = knownRefs(ctx).map((k, i) => {
      const p = list.patches[i],
        ref = tips.get(k.display) ?? k.ref,
        sha = ref ? git.revParse(ctx.repo, ref) : null,
        check = sha ? git.mergeTreeCheck(ctx.repo, upstream, sha) : null,
        base = sha ? git.git(ctx.repo, ["merge-base", sha, upstream]).stdout.trim() : "",
        prState = p.source.kind === "pr" ? (prInfo(p.source.repo, p.source.number, ctx.env)?.state ?? null) : null,
        known = last?.patches?.find(x => x.display === k.display);
      return {
        patch: k.display,
        url: patchLink(p.source, fork),
        clean: check ? check.clean : null,
        files: check?.files ?? [],
        own: owns.get(k.display) ?? null,
        pr: prState,
        pinned: p.pin ?? null,
        checks: known?.checks ?? null,
        acceptance: known?.acceptance ?? (p.acceptance ? null : "unverified"),
        behind: base ? Number(git.git(ctx.repo, ["rev-list", "--count", "--no-merges", `${base}..${upstream}`]).stdout.trim()) || 0 : null,
      };
    });
    v.note = own.note;
  }
  return {
    code: 0,
    lines: view.render(v, { color: !!io.color }),
    json: {
      run: v.run,
      upstream: { name, tip: upstream, newCommitsSinceBuild: v.sinceBuild ?? null },
      patches: v.rows.map(r => ({
        display: r.patch,
        pr: r.pr ?? null,
        pinned: r.pinned ?? null,
        merges: r.clean,
        conflicts: r.files,
        rebase: r.own ? r.own.kind : null,
        rebaseDetail: r.own ?? null,
        behind: r.behind ?? null,
        checks: r.checks ?? null,
        acceptance: r.acceptance ?? null,
      })),
      note: v.note,
    },
  };
}
