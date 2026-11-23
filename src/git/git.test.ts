import { expect, test } from "bun:test";
import { mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { modifiedFiles, requireVersion } from "./git";
import { repositoryOf, sameRepository } from "./remotes";

test("a git older than 2.38 is refused with the minimum version", () => {
  expect(() => requireVersion("/", "2.38", "2.37.1")).toThrow("git 2.38 or newer is required (found 2.37.1)");
  expect(() => requireVersion("/", "2.38", "2.38.0")).not.toThrow();
  expect(() => requireVersion("/", "2.38", "2.56.0 (Apple Git-1)")).not.toThrow();
});

test("remote URLs compare by repository, however they are spelled", () => {
  const same = [
    "git@github.com:Me/Widget.git",
    "https://github.com/me/widget",
    "ssh://git@github.com:22/me/widget.git",
    "https://user@github.com/me/widget/",
  ].map(repositoryOf);
  expect(new Set(same).size).toBe(1);
  expect(repositoryOf("file:///tmp/github/me/widget.git")).toBe("/tmp/github/me/widget");
  expect(repositoryOf("git@host:1234/repo")).toBe("host/1234/repo");
  expect(sameRepository("me/widget", "github.com/me/widget")).toBe(true);
  expect(sameRepository("me/widget", "/tmp/github/me/widget")).toBe(true);
  expect(sameRepository("acme/widget", "github.com/me/widget")).toBe(false);
});

test("modifiedFiles lists tracked changes, staged or not, unquoted and renamed, never untracked files", () => {
  const dir = mkdtempSync(join(tmpdir(), "debaser-git-")),
    run = (...args: string[]) => {
      const r = Bun.spawnSync(["git", ...args], { cwd: dir, stdout: "pipe", stderr: "pipe" });
      if (r.exitCode !== 0) throw Error(`git ${args.join(" ")}: ${r.stderr.toString()}`);
    };
  try {
    run("init", "-q", "-b", "main");
    run("config", "user.name", "Test");
    run("config", "user.email", "test@example.invalid");
    writeFileSync(join(dir, "a.txt"), "a\n");
    writeFileSync(join(dir, "b.txt"), "b\n");
    writeFileSync(join(dir, "old name.txt"), "renamed\n");
    writeFileSync(join(dir, "tab\there.txt"), "quoted\n");
    run("add", ".");
    run("commit", "-q", "-m", "base");
    expect(modifiedFiles(dir)).toEqual([]);
    writeFileSync(join(dir, "a.txt"), "changed\n");
    writeFileSync(join(dir, "b.txt"), "staged\n");
    writeFileSync(join(dir, "tab\there.txt"), "changed\n");
    run("add", "b.txt");
    run("mv", "old name.txt", "new name.txt");
    writeFileSync(join(dir, "new.txt"), "untracked\n");
    expect(modifiedFiles(dir).sort()).toEqual(["a.txt", "b.txt", "new name.txt", "tab\there.txt"]);
    // A rename seen only in the work tree (intent-to-add) also carries its source path.
    run("commit", "-q", "-a", "-m", "more");
    writeFileSync(join(dir, "c.txt"), "content long enough to be found as a rename\n");
    run("add", "c.txt");
    run("commit", "-q", "-m", "c");
    renameSync(join(dir, "c.txt"), join(dir, "d.txt"));
    run("add", "-N", "d.txt");
    expect(modifiedFiles(dir)).toEqual(["d.txt"]);
    // A git status that fails is never read as "clean".
    writeFileSync(join(dir, ".git", "index"), "not an index");
    expect(() => modifiedFiles(dir)).toThrow(/git status in .* failed/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
