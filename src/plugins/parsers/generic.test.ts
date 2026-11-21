import { expect, test } from "bun:test";
import { failureText, generic, namedPaths } from "./generic";

test("a failure log names a file only outside lines that hold nothing but a path", () => {
  const log = ["$ sh -c test -f src/e.ts", "src/a.test.ts:", "(pass) works", "  src/b.test.ts", "src/c.ts(3,4): error", "at x (/r/src/d.ts:1:2)"];
  const text = failureText(log.join("\n"));
  expect(["src/a.test.ts", "src/b.test.ts", "src/c.ts", "src/d.ts", "src/e.ts"].map(f => text.includes(f))).toEqual([
    false,
    false,
    true,
    true,
    false,
  ]);
  expect(namedPaths(log.join("\n"))).toEqual(expect.arrayContaining(["src/c.ts"]));
  expect(namedPaths(log.join("\n"))).not.toContain("src/a.test.ts");
  const parsed = generic.parse(log.join("\n"), "/r");
  expect(parsed.summary).toBe("");
  expect(parsed.narrowedArgs).toBeUndefined();
});
