/** `move --propose`'s git work (spec 003, research R2, R3, R5): the commits
 * of the last fetch (or a fresh one), merge tests in the object database only,
 * the pure ordering of `core/order`, and both orders verified from start to end. */
import type { Context } from "../core/context";
import { listOf, upstreamRemote } from "../core/context";
import { Explained } from "../core/errors";
import { type Fixed, type PairResult, type Participant, type Proposal, propose, settle } from "../core/order";
import { paths } from "../core/paths";
import type { Event } from "../core/runstate";
import * as git from "../git/git";
import { mergeOnto, mergeTreeCheck } from "../git/merge";
import { display, sourceKey } from "../plugins/sources/parse";
import { lastBuildResult, resultKeys } from "../report/report";
import { fetchPatch } from "./fetch";
import { knownCommits } from "./known";

/** The patches the newest build report found merged upstream, by `sourceKey`. */
function mergedUpstream(ctx: Context): Set<string> {
  const result = lastBuildResult(paths.reports(ctx.dir));
  return new Set(result ? resultKeys(result, "skipped-merged") : []);
}

/** Each live patch's commit and whether it is skipped, from a fresh fetch
 * done the way `build` does it, or from the last one (FR-020, FR-021). */
function commits(ctx: Context, fetch: boolean): { upstream: string; commit: (string | null)[]; skip: boolean[] } {
  const { repo } = ctx,
    list = listOf(ctx),
    remote = upstreamRemote(ctx);
  if (!fetch) {
    const known = knownCommits(ctx),
      resolved = known.map(k => (k.ref ? git.revParse(repo, k.ref) : null)),
      upstream = git.revParse(repo, `refs/remotes/${remote}/${list.upstream.branch}`),
      merged = mergedUpstream(ctx),
      missing = [...(upstream ? [] : [`upstream (${remote}/${list.upstream.branch})`]), ...known.filter((_, i) => !resolved[i]).map(k => k.display)];
    if (missing.length)
      throw new Explained(`no fetched commit for ${missing.join(", ")}`, ["  fetch first: debaser move --propose --fetch"], "patches are not fetched");
    return {
      upstream: upstream!,
      commit: resolved,
      // A pinned patch merges its own commit: only whether upstream contains it counts, as in `build`.
      skip: list.patches.map((p, i) => (!p.pin && merged.has(sourceKey(p.source))) || git.isAncestor(repo, resolved[i]!, upstream!)),
    };
  }
  ctx.progress(`fetching ${remote} ${list.upstream.branch}`);
  const upstream = git.fetchRemote(repo, remote, list.upstream.branch),
    run = { upstream: { tip: upstream }, events: [] as Event[] },
    commit: (string | null)[] = [],
    skip: boolean[] = [];
  for (const p of list.patches) {
    // An own branch takes part at its local tip (FR-021); one only on origin, or pinned, is fetched as `build` does.
    const local = p.source.kind === "branch" && !p.pin ? git.revParse(repo, `refs/heads/${p.source.name}`) : null;
    if (local) {
      commit.push(local);
      skip.push(git.isAncestor(repo, local, upstream));
      continue;
    }
    ctx.progress(`fetching ${display(p.source)}`);
    const planned = fetchPatch(ctx, p, run);
    commit.push(planned.commit);
    skip.push(!!planned.skip);
  }
  for (const e of run.events) ctx.progress(`${e.kind.endsWith("warning") ? "warning" : "note"}: ${e.patch ? `${e.patch}: ` : ""}${e.detail ?? e.kind}`);
  return { upstream, commit, skip };
}

/** The proposal for the live patches (FR-013 to FR-021): merge tests write
 * only unreachable objects; no working tree, index, ref or rerere change. */
export function computeProposal(ctx: Context, o: { fetch: boolean }): { proposal: Proposal; names: string[] } {
  const { repo } = ctx,
    list = listOf(ctx),
    names = list.patches.map(p => display(p.source)),
    { upstream, commit, skip } = commits(ctx, o.fetch),
    participants: Participant[] = [],
    fixed: Fixed[] = [],
    // Each participant merged onto upstream alone, which its pair tests build on.
    single = new Map<number, string>();
  ctx.progress(`testing ${skip.filter(s => !s).length} patches on upstream`);
  list.patches.forEach((p, index) => {
    if (skip[index]) return void fixed.push({ index, why: "skipped" });
    const alone = mergeOnto(repo, upstream, commit[index]!);
    if (!alone.clean) return void fixed.push({ index, why: "upstream", files: alone.files });
    single.set(index, alone.commit!);
    participants.push({ index, own: p.source.kind === "branch", commit: commit[index]! });
  });
  const pairs: PairResult[] = [];
  if (participants.length > 1) ctx.progress(`testing ${(participants.length * (participants.length - 1)) / 2} pairs in both orders`);
  for (const [i, a] of participants.entries())
    for (const b of participants.slice(i + 1)) {
      const ab = mergeTreeCheck(repo, single.get(a.index)!, b.commit),
        ba = mergeTreeCheck(repo, single.get(b.index)!, a.commit);
      pairs.push({ a: a.index, b: b.index, ab: ab.clean, ba: ba.clean, files: [...new Set([...ab.files, ...ba.files])].sort() });
    }
  const p = propose(names, participants, fixed, pairs),
    // A conflicting patch is counted and left out; the next merges onto the last clean result (FR-016).
    conflicts = (order: number[]) => {
      let base = upstream,
        count = 0;
      for (const index of order) {
        if (skip[index]) continue;
        const merged = mergeOnto(repo, base, commit[index]!);
        if (merged.clean) base = merged.commit!;
        else count++;
      }
      return count;
    };
  ctx.progress("verifying the current and the proposed order");
  const current = conflicts(p.current),
    proposed = p.proposed.every((index, i) => index === p.current[i]) ? current : conflicts(p.proposed);
  return { proposal: settle(p, { current, proposed }), names };
}
