import type { EffectiveRecipe } from "../recipes/types";
import { table, title } from "../live/term";

/** The effective recipe with the layer each value came from (FR-044). */
export function render(r: EffectiveRecipe, o: { color: boolean; note?: string | null }): string[] {
  const from = (key: string) => r.provenance[key] ?? "",
    rows = (pairs: [string, string, string][]) => table(["VALUE", "SETTING", "LAYER"], pairs.map(([k, v, l]) => [{ text: k }, { text: v }, { text: l, tone: "dim" as const }]), { color: o.color }),
    lines = [`${title(o.color)} recipe · ${r.layers.join(" < ") || "none"}`, ""];
  lines.push(
    ...table(
      ["STEP", "COMMAND", "PARSER", "LAYER"],
      r.steps.map(s => [
        { text: s.name },
        { text: `${s.run.join(" ")}${s.timeout ? ` (timeout ${s.timeout}s)` : ""}` },
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
  if (r.afterBuild) pairs.push(["after_build", r.afterBuild.join(" "), from("after_build")]);
  if (r.leftovers.length) pairs.push(["leftovers", r.leftovers.join(", "), from("leftovers")]);
  for (const name of Object.keys(r.prompts)) pairs.push([`prompts.${name}`, "overridden", from(`prompts.${name}`)]);
  lines.push(...rows(pairs));
  if (o.note) lines.push("", o.note);
  return lines;
}
