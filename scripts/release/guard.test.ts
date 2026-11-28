import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
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

/** Runs guard.sh with stubbed git and gh so the release-exists check is
 * reachable without a repository or network. */
function guardWithStubs(release: "exists" | "missing") {
  const bin = mkdtempSync(join(tmpdir(), "debaser-guard-bin-"));
  writeFileSync(join(bin, "git"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(
    join(bin, "gh"),
    [
      "#!/bin/sh",
      'if [ "$1" = "run" ] && [ "$2" = "list" ]; then echo 1; exit 0; fi',
      'if [ "$1" = "api" ]; then',
      release === "exists" ? "  exit 0" : '  echo "HTTP 404: Not Found" >&2; exit 1',
      "fi",
      "exit 0",
      "",
    ].join("\n"),
    { mode: 0o755 },
  );
  return Bun.spawnSync(["bash", join(root, "scripts/release/guard.sh")], {
    cwd: root,
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, TAG: `v${pkgVersion}`, SHA: "deadbeef", GH_TOKEN: "x" },
    stdout: "pipe",
    stderr: "pipe",
  });
}

test("an existing release is refused instead of passing the guard", () => {
  const result = guardWithStubs("exists");
  expect(result.exitCode).not.toBe(0);
  expect(result.stderr.toString()).toContain("already exists");
});

test("a missing release passes the guard when every other check is green", () => {
  const result = guardWithStubs("missing");
  expect(result.stderr.toString()).not.toContain("already exists");
  expect(result.exitCode).toBe(0);
});

test("a missing input refuses the release instead of proceeding", () => {
  for (const missing of ["TAG", "SHA", "GH_TOKEN"]) {
    const result = guard({ TAG: "v0.1.0", SHA: "deadbeef", GH_TOKEN: "x" }, [missing]);
    expect(result.exitCode).not.toBe(0);
    expect(result.stderr.toString()).toContain(`${missing} is required`);
  }
});
