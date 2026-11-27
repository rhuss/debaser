import { expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as git from "../git/git";
import { snapshot } from "../git/snapshot";
import { acceptFix } from "./verify";

function repo(): string {
  const dir = mkdtempSync(join(tmpdir(), "debaser-verify-"));
  for (const args of [
    ["init", "-q", "-b", "main"],
    ["config", "user.name", "Test"],
    ["config", "user.email", "test@example.invalid"],
  ])
    git.must(dir, args);
  writeFileSync(join(dir, "a.txt"), "a\n");
  git.must(dir, ["add", "."]);
  git.must(dir, ["commit", "-q", "-m", "init"]);
  return dir;
}

test("a fix that deletes an untracked file leaves that file out of what is staged", () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, "leftover.json"), "{}\n");
    const head = git.head(dir),
      before = snapshot(dir);
    // The harness deletes the untracked file and fixes a tracked one.
    rmSync(join(dir, "leftover.json"));
    writeFileSync(join(dir, "a.txt"), "fixed\n");
    const verdict = acceptFix(dir, { head, snapshot: before });
    expect(verdict).toEqual({ ok: true, files: ["a.txt"] });
    if (verdict.ok) expect(() => git.must(dir, ["add", "-A", "--", ...verdict.files])).not.toThrow();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a fix that only deletes an untracked file changed nothing", () => {
  const dir = repo();
  try {
    writeFileSync(join(dir, "leftover.json"), "{}\n");
    const head = git.head(dir),
      before = snapshot(dir);
    rmSync(join(dir, "leftover.json"));
    expect(acceptFix(dir, { head, snapshot: before })).toMatchObject({ ok: false, reason: "it changed nothing" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a file the harness committed and then deleted still has its deletion staged", () => {
  const dir = repo();
  try {
    const head = git.head(dir),
      before = snapshot(dir);
    writeFileSync(join(dir, "new.txt"), "new\n");
    git.must(dir, ["add", "new.txt"]);
    git.must(dir, ["commit", "-q", "-m", "harness commit"]);
    rmSync(join(dir, "new.txt"));
    const verdict = acceptFix(dir, { head, snapshot: before });
    expect(verdict).toEqual({ ok: true, files: ["new.txt"] });
    if (verdict.ok) git.must(dir, ["add", "-A", "--", ...verdict.files]);
    expect(git.must(dir, ["diff", "--cached", "--name-only"]).trim()).toBe("");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
