import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dir, "..", "..");
const pkgVersion = JSON.parse(readFileSync(join(root, "package.json"), "utf8")).version as string;
const otherVersion = pkgVersion === "9.9.9" ? "9.9.8" : "9.9.9";

/** Runs guard.sh with a stubbed environment. These cases are refused before
 * guard.sh reaches git or gh, so no network or repository is needed. */
function guard(env: Record<string, string>, remove: string[] = []) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries(process.env)) if (value !== undefined) merged[key] = value;
  Object.assign(merged, env);
  for (const key of remove) delete merged[key];
  return Bun.spawnSync(["bash", join(root, "scripts/release/guard.sh")], {
    cwd: root,
    env: merged,
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("a tag that disagrees with package.json is refused", () => {
  const result = guard({ TAG: `v${otherVersion}`, SHA: "deadbeef", GH_TOKEN: "x" });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain(`package.json declares ${pkgVersion}`);
});

test("a malformed tag is refused before any build", () => {
  const result = guard({ TAG: "release-1.0.0", SHA: "deadbeef", GH_TOKEN: "x" });
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("not v<semantic-version>");
});

test("a missing input refuses the release instead of proceeding", () => {
  for (const missing of ["TAG", "SHA", "GH_TOKEN"]) {
    const result = guard({ TAG: "v0.1.0", SHA: "deadbeef", GH_TOKEN: "x" }, [missing]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(`${missing} is required`);
  }
});
