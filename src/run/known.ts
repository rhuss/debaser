import type { Context } from "../core/context";
import { listOf } from "../core/context";
import * as git from "../git/git";
import { display, privateRef } from "../plugins/sources/parse";

/** Where each live patch was last fetched to, without fetching: the pin, an
 * own branch's local copy (else origin's), or a PR's or fork branch's private ref. */
export function knownCommits(ctx: Context): { display: string; ref: string | null }[] {
  return listOf(ctx).patches.map(p => {
    const s = p.source,
      shown = display(s);
    if (p.pin) return { display: shown, ref: p.pin };
    if (s.kind !== "branch") return { display: shown, ref: privateRef(s) };
    if (git.revParse(ctx.repo, `refs/heads/${s.name}`)) return { display: shown, ref: `refs/heads/${s.name}` };
    return { display: shown, ref: `refs/remotes/origin/${s.name}` };
  });
}
