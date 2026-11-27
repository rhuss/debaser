import * as lock from "../../core/lock";
import type { Context } from "../../core/context";
import { listOf, upstreamRemote } from "../../core/context";
import { paths } from "../../core/paths";
import * as runstate from "../../core/runstate";
import type { RebaseResult } from "../../core/runstate";
import * as git from "../../git";
import { prInfo } from "../../github/gh";
import { select } from "../../rebase/select";
import { pushCommand } from "../../rebase/push";
import { lastBuildResult } from "../../report/report";
import { knownCommits } from "../../run/known";
import { whereStopped } from "../../run/where";
import { configInfo } from "../../core/tree";
import { paint } from "../../live/term";
import { configHeader } from "../../views/config";
import { patchLink } from "../../views/list";
import * as view from "../../views/status";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

/** The commands that can run an in-worktree rebase check. */
const rebasing = new Set(["build", "rebase", "continue"]);
/** `checking`: a command that can run an in-worktree rebase check holds the lock right now. */
function ownState(r: RebaseResult, repo: string, checking: boolean): view.Own {
  // An in-worktree rebase still checking the branch: it already moved the branch, which then
  // looks up to date (never pushed), diverged from origin or push pending until the check passes.
  // Without a rebasing command the marker is left over from a killed run, and the state as read is real.
  if (checking && git.revParse(repo, git.refs.rebaseChecking(r.branch))) return { kind: "checking" };
  if (r.pending) return { kind: "pending", command: pushCommand(r) };
  if (r.outcome === "current") return { kind: "current", ...(r.reason ? { reason: r.reason } : {}) };
  if (r.worktree) return { kind: "worktree", path: r.worktree, rebasableThere: !!r.rebasableThere };
  if (r.diverged) return { kind: "diverged" };
  return { kind: "other", reason: r.reason ?? r.outcome };
}
type LastResult = { command?: string; patches?: { display: string; checks?: string; acceptance?: string }[] };
/** The newest build's result.json, if any: a `rebase` run since then moves
 * `latest` but has no check or acceptance results to show. */
function lastResult(ctx: Context): LastResult | null {
  return lastBuildResult(paths.reports(ctx.dir)) as LastResult | null;
}

/** The command running in this checkout right now, from a lock whose process is alive. */
function liveRunning(ctx: Context): view.View["running"] {
  const held = lock.liveHolder(ctx.dir);
  return held ? { command: held.command, pid: held.pid, startedAt: held.startedAt } : null;
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
      running: liveRunning(ctx),
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
      owns.set(r.patch, ownState(r, ctx.repo, rebasing.has(v.running?.command ?? "")));
      const at = r.to ?? r.from;
      if (at) tips.set(r.patch, at);
    }
    const fork = ctx.color && git.hasRemote(ctx.repo, "origin") ? git.remoteTarget(ctx.repo, "origin", "push") : null;
    // Upstream commits since the last build: from where the integration branch meets upstream.
    const since = built ? git.git(ctx.repo, ["merge-base", built, upstream]).stdout.trim() : "";
    v.sinceBuild = since ? Number(git.git(ctx.repo, ["rev-list", "--count", "--no-merges", `${since}..${upstream}`]).stdout.trim()) || 0 : null;
    v.rows = knownCommits(ctx).map((k, i) => {
      const p = list.patches[i],
        ref = tips.get(k.display) ?? k.ref,
        sha = ref ? git.revParse(ctx.repo, ref) : null,
        check = sha ? git.mergeTreeCheck(ctx.repo, upstream, sha) : null,
        base = sha ? git.git(ctx.repo, ["merge-base", sha, upstream]).stdout.trim() : "",
        prState = p.source.kind === "pr" ? (prInfo(p.source.repo, p.source.number, ctx.env)?.state ?? "UNKNOWN") : null,
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
        acceptance: lastAcceptance(known?.acceptance, !!p.acceptance),
        behind: base ? Number(git.git(ctx.repo, ["rev-list", "--count", "--no-merges", `${base}..${upstream}`]).stdout.trim()) || 0 : null,
      };
    });
    v.note = own.note;
  }
  // Read only: the build directory is described, never checked or created (FR-022).
  const config = configInfo(ctx),
    dim = (text: string) => paint(text, "dim", !!io.color);
  return {
    code: 0,
    lines: [
      ...configHeader(config, { color: !!io.color, branch: list.branch, branchExists: !!built }),
      ...config.tree.modified.slice(0, 10).map(file => `  ${dim("modified:")} ${file}`),
      ...(config.tree.modified.length > 10 ? [`  ${dim(`and ${config.tree.modified.length - 10} more`)}`] : []),
      "",
      ...view.render(v, { color: !!io.color }),
    ],
    json: {
      config,
      run: v.run,
      running: v.running ?? null,
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

/** A patch's acceptance result from the last build: `none` without a check,
 * null for a check with no result yet (added since). A result.json from before
 * `none` says `unverified` for a patch without a check. */
function lastAcceptance(last: string | null | undefined, hasCheck: boolean): string | null {
  const result = last === "unverified" ? "none" : (last ?? null);
  if (!hasCheck) return result ?? "none";
  return result === "none" ? null : result;
}
