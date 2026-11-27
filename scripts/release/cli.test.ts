import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const script = join(import.meta.dir, "version.ts");

/** Runs the CLI exactly the way the workflows do, so argument order, stdout
 * and exit codes are tested, not only the imported functions. */
function version(...args: string[]) {
  const result = Bun.spawnSync(["bun", script, ...args], { stdout: "pipe", stderr: "pipe" });
  return { code: result.exitCode, out: result.stdout.toString(), err: result.stderr.toString() };
}

test("parse-tag prints the version and refuses a malformed tag", () => {
  expect(version("parse-tag", "v1.2.3")).toEqual({ code: 0, out: "1.2.3\n", err: "" });
  expect(version("parse-tag", "1.2.3").code).not.toBe(0);
});

test("is-prerelease prints true or false", () => {
  expect(version("is-prerelease", "1.2.3").out).toBe("false\n");
  expect(version("is-prerelease", "1.2.3-rc.1").out).toBe("true\n");
});

test("is-newer distinguishes newer, not newer and an unparseable version", () => {
  expect(version("is-newer", "0.2.0", "0.1.0").code).toBe(0);
  expect(version("is-newer", "0.1.0", "0.2.0").code).toBe(1);
  const broken = version("is-newer", "0.2.0", "not-a-version");
  expect(broken.code).toBe(2);
  expect(broken.err).toContain("semantic version");
});

test("asset-name builds a contract name and refuses an unknown platform", () => {
  expect(version("asset-name", "1.2.3", "linux", "arm64").out).toBe("debaser-1.2.3-linux-arm64\n");
  expect(version("asset-name", "1.2.3", "windows", "amd64").code).not.toBe(0);
});

test("sums prints a checksum line for each of the four assets", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-cli-sums-"));
  for (const name of [
    "debaser-1.2.3-linux-amd64",
    "debaser-1.2.3-linux-arm64",
    "debaser-1.2.3-darwin-arm64",
    "debaser-1.2.3-darwin-amd64",
  ])
    writeFileSync(join(dir, name), `${name}\n`);
  const result = version("sums", dir, "1.2.3");
  expect(result.code).toBe(0);
  expect(result.out.trimEnd().split("\n")).toHaveLength(4);
  expect(result.out).toContain("  debaser-1.2.3-linux-amd64\n");
});
