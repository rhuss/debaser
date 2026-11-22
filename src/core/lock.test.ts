import { expect, test } from "bun:test";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { acquire, holder } from "./lock";

const dir = () => mkdtempSync(join(tmpdir(), "debaser-lock-"));

test("a lock is taken, refused while held by a live process, and released", () => {
  const d = dir();
  const release = acquire(d, "build");
  expect(holder(d)?.command).toBe("build");
  // A live process (this test runner's parent) holding it refuses.
  writeFileSync(join(d, "lock"), JSON.stringify({ pid: process.ppid, command: "rebase", startedAt: "x" }));
  expect(() => acquire(d, "continue")).toThrow(`rebase (pid ${process.ppid}`);
  writeFileSync(join(d, "lock"), JSON.stringify({ pid: process.pid, command: "build", startedAt: "x" }));
  release();
  expect(existsSync(join(d, "lock"))).toBe(false);
});

test("a lock left by a dead process is taken over", () => {
  const d = dir();
  const dead = Bun.spawnSync(["sh", "-c", "echo $$"]).stdout.toString().trim();
  writeFileSync(join(d, "lock"), JSON.stringify({ pid: Number(dead), command: "build", startedAt: "x" }));
  const release = acquire(d, "rollback");
  expect(holder(d)).toMatchObject({ pid: process.pid, command: "rollback" });
  release();
});
