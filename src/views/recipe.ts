import type { EffectiveRecipe } from "../recipes/types";
import { table, title } from "../live/term";

export type LayerSource = { kind: "built-in" } | { kind: "repo"; path: string; commit: string } | { kind: "local"; path: string };

/** Where a layer came from, from its id (FR-018): `generic:*` and `project:*`
 * ship with debaser, `repo:<path>@<sha7>` is the project's committed recipe at
 * that upstream commit, and `local` is the override in debaser's directory. */
export function layerSource(id: string, localRecipe: string): LayerSource {
  const repo = /^repo:(.+)@([0-9a-f]+)$/.exec(id);
  if (repo) return { kind: "repo", path: repo[1], commit: repo[2] };
  if (id === "local") return { kind: "local", path: localRecipe };
  return { kind: "built-in" };
}
/** A layer with its source, as the layers line shows it. */
function layerLabel(id: string, source: LayerSource): string {
  switch (source.kind) {
    case "repo":
      return `repo ${source.path} at upstream ${source.commit}`;
    case "local":
      return `local ${source.path}`;
    default:
      return `${id} (built-in)`;
  }
}

/** The effective recipe with the layer each value came from (FR-044). */
export function render(r: EffectiveRecipe, o: { color: boolean; note?: string | null; localRecipe: string }): string[] {
  const from = (key: string) => r.provenance[key] ?? "",
    rows = (pairs: [string, string, string][]) => table(["VALUE", "SETTING", "LAYER"], pairs.map(([k, v, l]) => [{ text: k }, { text: v }, { text: l, tone: "dim" as const }]), { color: o.color }),
    lines = [`${title(o.color)} recipe · ${r.layers.map(id => layerLabel(id, layerSource(id, o.localRecipe))).join(" < ") || "none"}`, ""];
  lines.push(
    ...table(
      ["STEP", "COMMAND", "PARSER", "LAYER"],
      r.steps.map(s => [
        { text: s.name },
        { text: `${s.run.join(" ")}${s.tests ? ` ({tests} = ${s.tests.join(" ")})` : ""}${s.timeout ? ` (timeout ${s.timeout}s)` : ""}` },
        { text: s.parser ?? "-", tone: "dim" as const },
        { text: from(`steps.${s.name}`), tone: "dim" as const },
      ]),
      { color: o.color },
    ),
    "",
  );
  const pairs: [string, string, string][] = [["project_name", r.projectName, from("project_name") || "default"]];
  if (r.install) for (const [k, v] of Object.entries(r.install)) pairs.push([`install.${k}`, Array.isArray(v) ? v.join(", ") : String(v), from(`install.${k}`)]);
  if (r.artifact) for (const [k, v] of Object.entries(r.artifact)) pairs.push([`artifact.${k}`, String(v), from(`artifact.${k}`)]);
  if (r.afterBuild) pairs.push(["after_build", r.afterBuild.length ? r.afterBuild.join(" ") : "none", from("after_build")]);
  if (r.leftovers.length) pairs.push(["leftovers", r.leftovers.join(", "), from("leftovers")]);
  for (const name of Object.keys(r.prompts)) pairs.push([`prompts.${name}`, "overridden", from(`prompts.${name}`)]);
  lines.push(...rows(pairs));
  if (o.note) lines.push("", o.note);
  return lines;
}
