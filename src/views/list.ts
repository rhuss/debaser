/** Renders `list` as a table of the patches in merge order, or of the retired
 * ones, with each patch linked to its page on a terminal. */
import type { PatchList } from "../core/patchlist";
import { branchPath } from "../plugins/sources/github";
import { display, link } from "../plugins/sources/parse";
import type { Source } from "../plugins/sources/types";
import { type Cell, type Tone, table, title as toolTitle } from "../live/term";

/** Where a patch can be looked at: a PR's page, or a branch on GitHub. Own
 * branches link into the fork `origin` pushes to (`host/owner/repo`), when
 * that is on GitHub; anything else has no link. */
export function patchLink(source: Source, fork: string | null): string | null {
  if (source.kind === "branch") return fork?.startsWith("github.com/") ? `https://${fork}/tree/${branchPath(source.name)}` : null;
  return link(source);
}

/** Each kind of patch in its own color, so a list shows at a glance which are
 * PRs, own branches and branches from other forks. */
const kindTone: Record<Source["kind"], Tone> = { pr: "cyan", branch: "blue", "fork-branch": "magenta" };

export function render(
  config: Pick<PatchList, "patches" | "retired">,
  o: { retired: boolean; upstream: string; fork: string | null; color: boolean; columns?: number },
): string[] {
  const title = toolTitle(o.color),
    name = (s: Source): Cell => ({
      text: display(s),
      url: patchLink(s, o.fork),
      tone: kindTone[s.kind],
    }),
    dim = (text: string): Cell => ({ text, tone: "dim" });
  if (o.retired) {
    if (!config.retired.length) return ["no retired patches"];
    const n = config.retired.length;
    return [
      `${title} · ${n} retired patch${n === 1 ? "" : "es"}`,
      "",
      ...table(
        ["PATCH", "RETIRED", "REASON"],
        config.retired.map(p => [name(p.source), dim(p.retired), { text: p.reason }]),
        { color: o.color, columns: o.columns, gap: 2 },
      ),
    ];
  }
  if (!config.patches.length) return ["no patches", ...retiredSection(config, o, name, dim)];
  const n = config.patches.length;
  return [
    `${title} · ${n} patch${n === 1 ? "" : "es"}, merged in this order onto ${o.upstream}`,
    "",
    ...table(
      ["#", "PATCH", "ADDED", "DESCRIPTION"],
      config.patches.map((p, i) => [
        dim(String(i + 1)),
        name(p.source),
        dim(p.added),
        { text: [p.description, p.pin ? `(pinned ${p.pin.slice(0, 7)})` : "", p.acceptance ? "" : "(unverified)"].filter(Boolean).join(" ") },
      ]),
      { color: o.color, columns: o.columns, gap: 2 },
    ),
    ...retiredSection(config, o, name, dim),
  ];
}
/** The retired patches below the live ones, when there are any. */
function retiredSection(
  config: Pick<PatchList, "retired">,
  o: { color: boolean; columns?: number },
  name: (s: Source) => Cell,
  dim: (text: string) => Cell,
): string[] {
  if (!config.retired.length) return [];
  const n = config.retired.length;
  return [
    "",
    `${n} retired patch${n === 1 ? "" : "es"}`,
    "",
    ...table(["PATCH", "RETIRED", "REASON"], config.retired.map(p => [name(p.source), dim(p.retired), { text: p.reason }]), {
      color: o.color,
      columns: o.columns,
      gap: 2,
    }),
  ];
}
