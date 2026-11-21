/** The behavior contract (FR-052, SC-001): every carried reference scenario
 * names a debaser test that exists. */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..");
type Row = { reference: string; status: string; target: string };

export function contractRows(): Row[] {
  const text = readFileSync(join(root, "docs", "behavior-contract.md"), "utf8");
  return text
    .split("\n")
    .filter(line => line.startsWith("| ") && !line.startsWith("| Reference test") && !line.startsWith("|---"))
    .map(line => {
      const cells = line
        .split(/(?<!\\)\|/)
        .slice(1, -1)
        .map(c => c.replaceAll("\\|", "|").trim());
      return { reference: cells[0], status: cells[1], target: cells[2] ?? "" };
    });
}
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : /\.test\.ts$/.test(name) ? [path] : [];
  });
}
function testTitles(): Set<string> {
  const titles = new Set<string>();
  for (const file of [...files(join(root, "src")), ...files(join(root, "tests"))]) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/\btest\(\s*("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)/g))
      titles.add(m[1].slice(1, -1).replace(/\\(.)/g, "$1"));
  }
  return titles;
}

test("the behavior contract lists every reference scenario once", () => {
  const rows = contractRows();
  expect(rows.length).toBe(141);
  expect(new Set(rows.map(r => r.reference)).size).toBe(rows.length);
  for (const r of rows) expect(["carried", "dropped"]).toContain(r.status);
  expect(rows.filter(r => r.status === "pending").map(r => r.reference)).toEqual([]);
});

test("every carried scenario names an existing debaser test, and every dropped one a reason", () => {
  const titles = testTitles(),
    missing = contractRows()
      .filter(r => r.status === "carried")
      .flatMap(r => r.target.split(" + ").filter(t => !titles.has(t.trim())).map(t => `${r.reference} -> ${t}`));
  expect(missing).toEqual([]);
  expect(contractRows().filter(r => r.status === "dropped" && !r.target)).toEqual([]);
});
