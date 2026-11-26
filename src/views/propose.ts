/** Renders `move --propose`'s proposal (contracts/cli.md "Proposal"): the
 * current and proposed order side by side, a reason per moved patch, the
 * conflicts no order avoids, and the verified conflict counts. */
import type { Proposal } from "../core/order";
import { paint, table } from "../live/term";

export function render(p: Proposal, names: string[], o: { color: boolean }): string[] {
  const indent = (lines: string[], by = "  ") => lines.map(line => by + line),
    section = (title: string, lines: string[]) => (lines.length ? ["", ...indent([paint(title, "bold", o.color), ...indent(lines)])] : []),
    entry = (index: number, at: number) => ({ text: `${at + 1} ${names[index]}` });
  return [
    `merge order proposal ${paint("(merge conflicts only; checks were not run)", "dim", o.color)}`,
    "",
    ...indent(
      table(
        ["CURRENT", "PROPOSED"],
        p.current.map((index, at) => [entry(index, at), entry(p.proposed[at], at)]),
        { color: o.color, gap: 8 },
      ),
    ),
    ...section("moved:", p.reasons),
    ...section(
      "conflicts no order avoids (the next build hands them to the harness):",
      p.unavoidable.map(u => `${names[u.a]} and ${names[u.b]}${u.files.length ? `: ${u.files.join(", ")}` : ""}`),
    ),
    ...section(
      "conflicts with upstream alone (no order avoids them; rebase or fix the patch):",
      p.upstream.map(u => `${names[u.index]}${u.files.length ? `: ${u.files.join(", ")}` : ""}`),
    ),
    ...section(
      "skipped (in upstream already; they keep their place):",
      p.skipped.map(index => names[index]),
    ),
    "",
    `  conflicts: current order ${p.counts.current}, proposed order ${p.counts.proposed}`,
  ];
}
