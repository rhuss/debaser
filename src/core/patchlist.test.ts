import { expect, test } from "bun:test";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, load, save, type PatchList } from "./patchlist";

const fresh = () => mkdtempSync(join(tmpdir(), "debaser-patchlist-"));
const read = (path: string) => readFileSync(path, "utf8");

test("a missing config has defaults; a saved one reads back the same", () => {
  const dir = join(fresh(), "not-yet");
  expect(load(dir)).toBeNull();
  const saved: PatchList = {
    ...create({ repo: "acme/widget", remote: "upstream", branch: "main" }),
    patches: [
      { source: { kind: "pr", repo: "acme/widget", number: 109 }, description: "Jump", added: "2026-11-04" },
      {
        source: { kind: "branch", name: "mine" },
        description: "Mine",
        added: "2026-11-04",
        pin: "a".repeat(40),
        acceptance: { run: ["{output}", "--version"], exit: 0, match: "widget \\d+" },
      },
    ],
    retired: [
      { source: { kind: "branch", name: "old" }, description: "Old", added: "2026-10-01", retired: "2026-11-04", reason: "merged" },
    ],
    harness: { command: ["claude", "-p"], attempts: 2, kind: "claude", tasks: { rebase: { command: ["pi"], kind: "pi" } } },
  };
  save(dir, saved);
  expect(read(join(dir, "patches.json"))).toEndWith("}\n");
  expect(read(join(dir, "patches.json"))).toContain('\n  "version": 1,');
  expect(load(dir)).toEqual(saved);
});

test("a config from a newer tool, or with a broken harness, is refused", () => {
  const dir = fresh(),
    file = join(dir, "patches.json"),
    up = { repo: "acme/widget", branch: "main" };
  writeFileSync(file, JSON.stringify({ version: 2, upstream: up }));
  expect(() => load(dir)).toThrow("newer than this debaser understands");
  writeFileSync(file, JSON.stringify({ version: 1, upstream: up, harness: { command: [] } }));
  expect(() => load(dir)).toThrow("harness.command must be a non-empty array of strings");
  writeFileSync(file, JSON.stringify({ version: 1, upstream: up, harness: { command: "claude" } }));
  expect(() => load(dir)).toThrow("harness.command");
  writeFileSync(file, JSON.stringify({ version: 1, upstream: up, rebase: "sometimes" }));
  expect(() => load(dir)).toThrow("rebase must be one of all, conflicting, off");
  writeFileSync(file, "{ not json");
  expect(() => load(dir)).toThrow(file);
});

test("harness.kind must be one of the registered adapters", () => {
  const dir = fresh(),
    file = join(dir, "patches.json"),
    up = { repo: "acme/widget", branch: "main" };
  writeFileSync(file, JSON.stringify({ version: 1, upstream: up, harness: { command: ["h"], kind: "gpt" } }));
  expect(() => load(dir)).toThrow("harness.kind must be one of claude, codex, pi, opencode, plain");
  for (const kind of ["claude", "codex", "pi", "opencode", "plain"]) {
    writeFileSync(file, JSON.stringify({ version: 1, upstream: up, harness: { command: ["h"], kind } }));
    expect(load(dir)?.harness?.kind).toBe(kind);
  }
});

test("fork-branch sources have exactly one of repo or url, without credentials", () => {
  const dir = fresh(),
    file = join(dir, "patches.json"),
    up = { repo: "acme/widget", branch: "main" },
    one = (source: unknown) =>
      writeFileSync(file, JSON.stringify({ version: 1, upstream: up, patches: [{ source, description: "x", added: "" }] }));
  one({ kind: "fork-branch", repo: "a/b", url: "https://x/y.git", branch: "b" });
  expect(() => load(dir)).toThrow("exactly one of repo or url");
  one({ kind: "fork-branch", url: "https://user:secret@x.org/y.git", branch: "b" });
  expect(() => load(dir)).toThrow("carries credentials");
  one({ kind: "fork-branch", url: "https://x.org/y.git", branch: "b" });
  expect(load(dir)?.patches[0].source).toEqual({ kind: "fork-branch", url: "https://x.org/y.git", branch: "b" });
});
