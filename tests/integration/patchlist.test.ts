import { expect, test, setDefaultTimeout } from "bun:test";
import { existsSync, realpathSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as patchlist from "../../src/core/patchlist";
import { display } from "../../src/plugins/sources/parse";
import { branch, configure, configureOwn, dirOf, fresh, git, read, run, stubGh, world } from "../support/world";

setDefaultTimeout(120_000);

const load = (dir: string) => patchlist.load(dir)!;

test("the first add creates the patch list from the upstream remote; --upstream overrides it", async () => {
  const w = world();
  stubGh(w, {});
  expect((await run(w, "add", "mine", "Mine")).code).toBe(0);
  const list = load(dirOf(w));
  expect(list.upstream).toEqual({ repo: "acme/widget", remote: "upstream", branch: "main" });
  expect(list.branch).toBe("debaser");
  // Outside the working tree: nothing shows in git status.
  expect(git(w.clone, "status", "--porcelain")).toBe("");

  const v = world();
  expect((await run(v, "add", "mine", "Mine", "--upstream", "someone/else")).code).toBe(0);
  expect(load(dirOf(v)).upstream.repo).toBe("someone/else");

  const u = world();
  git(u.clone, "remote", "rename", "upstream", "source");
  const refused = await run(u, "add", "mine", "Mine");
  expect(refused.code).toBe(1);
  expect(refused.err).toContain("no upstream remote");
  expect(refused.err).toContain("git remote add upstream");
  expect(existsSync(join(dirOf(u), "patches.json"))).toBe(false);
});

test("add creates an ignored config, dates entries, refuses duplicates and takes PR titles", async () => {
  const w = world();
  stubGh(w, { "acme/widget#109": { state: "OPEN", title: "viewer: jump to blocked agents" } });
  expect((await run(w, "add", "#109")).out).toBe("added acme/widget#109: jump to blocked agents\n");
  expect(git(w.clone, "status", "--porcelain")).toBe("");
  expect((await run(w, "add", "my-branch", "--description", "My change")).code).toBe(0);
  expect((await run(w, "add", "other/widget:topic", "Topic")).code).toBe(0);
  const duplicate = await run(w, "add", "109");
  expect(duplicate.code).toBe(1);
  expect(duplicate.err).toContain("acme/widget#109 is already in the list");
  // A branch without a description is named by its branch; a PR needs its title.
  expect((await run(w, "add", "other/widget:named")).out).toBe("added other/widget:named: named\n");
  expect((await run(w, "add", "https://github.com/acme/widget/pull/109")).err).toContain("acme/widget#109 is already in the list");
  expect((await run(w, "add", "https://github.com/other/widget/tree/topic")).err).toContain("other/widget:topic is already in the list");
  const untitled = await run(w, "add", "other/widget#7");
  expect(untitled.code).toBe(1);
  expect(untitled.err).toContain("needs a description");
  const saved = load(dirOf(w));
  expect(saved.patches.map(p => [display(p.source), p.description, p.added])).toEqual([
    ["acme/widget#109", "jump to blocked agents", "2026-11-04"],
    ["my-branch", "My change", "2026-11-04"],
    ["other/widget:topic", "Topic", "2026-11-04"],
    ["other/widget:named", "named", "2026-11-04"],
  ]);
  expect((await run(w, "remove", "other/widget:named", "--reason", "x")).code).toBe(0);
  // The configuration header first (spec 002, FR-017): no local recipe, no build yet.
  expect((await run(w, "list")).out).toBe(
    `data    ${dirOf(w)}\n` +
      `config  ${dirOf(w)}/patches.json  (local recipe: none)\n` +
      `build   ${realpathSync(w.root)}/clone-debaser  (not created yet)\n` +
      "\n" +
      "debaser · 3 patches, merged in this order onto upstream/main\n" +
      "\n" +
      "#  PATCH               ADDED       DESCRIPTION\n" +
      "1  acme/widget#109     2026-11-04  jump to blocked agents\n" +
      "2  my-branch           2026-11-04  My change\n" +
      "3  other/widget:topic  2026-11-04  Topic\n" +
      "\n" +
      "1 retired patch; list --verbose shows them\n",
  );
  expect((await run(w, "list", "--verbose")).out).toEndWith(
    "\n" + "1 retired patch\n" + "\n" + "PATCH               RETIRED     REASON\n" + "other/widget:named  2026-11-04  x\n",
  );
});

test("list marks a patch with an acceptance check, after its pin", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  branch(w, "b", { "b.txt": "b\n" });
  const pin = git(w.clone, "rev-parse", "a");
  configure(w, ["a", "b"], { patchExtra: { a: { pin, acceptance: { run: ["true"] } } } });
  const out = (await run(w, "list")).out;
  expect(out).toMatch(new RegExp(`^1 +a +\\S+ +about a \\(pinned ${pin.slice(0, 7)}\\) \\(with check\\)$`, "m"));
  expect(out).toMatch(/^2 +b +\S+ +about b$/m);
  const json = JSON.parse((await run(w, "list", "--json")).out);
  expect(json.patches.map((p: { display: string; hasCheck: boolean; verified?: boolean }) => [p.display, p.hasCheck, p.verified])).toEqual([
    ["a", true, undefined],
    ["b", false, undefined],
  ]);
});

test("remove retires a patch with its reason, which it needs off a terminal", async () => {
  const w = world();
  configure(w, ["my-branch", "#5"]);
  const unexplained = await run(w, "remove", "my-branch");
  expect(unexplained.code).toBe(1);
  expect(unexplained.err).toContain("needs --reason");
  const removed = await run(w, "remove", "my-branch", "--reason", "merged upstream");
  expect(removed.code).toBe(0);
  const saved = load(dirOf(w));
  expect(saved.patches.map(p => display(p.source))).toEqual(["acme/widget#5"]);
  expect(saved.retired).toHaveLength(1);
  expect(saved.retired[0]).toMatchObject({ reason: "merged upstream", description: "about my-branch" });
  expect(saved.retired[0].retired).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  expect((await run(w, "list")).out).toContain("1 retired patch; list --verbose shows them");
  const listed = (await run(w, "list", "--verbose")).out;
  expect(listed).toContain("acme/widget#5");
  expect(listed).toContain("1 retired patch\n");
  expect(listed).toMatch(/^my-branch  \d{4}-\d{2}-\d{2}  merged upstream$/m);
  expect((await run(w, "remove", "nope", "--reason", "x")).code).toBe(1);
});

test("--dir and DEBASER_DIR move every read and write, the option winning", async () => {
  const w = world(),
    viaEnv = join(fresh("dots"), "widget-build"),
    viaOption = join(fresh("opt"), "db");
  w.env.DEBASER_DIR = viaEnv;
  expect((await run(w, "add", "a-branch", "--description", "A")).code).toBe(0);
  expect(existsSync(join(viaEnv, "patches.json"))).toBe(true);
  expect((await run(w, "--dir", viaOption, "add", "b-branch", "--description", "B")).code).toBe(0);
  expect(load(viaOption).patches.map(p => p.description)).toEqual(["B"]);
  expect(load(viaEnv).patches.map(p => p.description)).toEqual(["A"]);
  expect((await run(w, "list")).out).toContain("a-branch");
  expect((await run(w, `--dir=${viaOption}`, "list")).out).toContain("b-branch");
  expect(existsSync(dirOf(w))).toBe(false);
});

test("a fork URL with credentials is refused, on add and in the config", async () => {
  const w = world();
  const added = await run(w, "add", "https://me:secret@git.example.org/x/widget.git#branch=fix", "--description", "X");
  expect(added.code).toBe(1);
  expect(added.err).toContain("carries credentials");
  expect(added.err).not.toContain("secret");
  expect(existsSync(join(dirOf(w), "patches.json"))).toBe(false);
  expect((await run(w, "add", "ssh://git@git.example.org/x/widget.git#branch=fix", "--description", "X")).code).toBe(0);
  const dir = fresh("config");
  writeFileSync(
    join(dir, "patches.json"),
    JSON.stringify({
      version: 1,
      upstream: { repo: "acme/widget", branch: "main" },
      patches: [{ source: { kind: "fork-branch", url: "https://x-access-token:t0k@github.com/a/b.git", branch: "c" }, description: "d" }],
    }),
  );
  expect(() => patchlist.load(dir)).toThrow("carries credentials");
});

test("add refuses the custom branch and its backup as patches", async () => {
  const w = world();
  configureOwn(w, []);
  for (const name of ["debaser", "debaser-prev"]) {
    const result = await run(w, "add", name, "--description", "x");
    expect(result.code).toBe(1);
    expect(result.err).toContain("is a branch debaser resets");
  }
});

test("add --pin stores the commit, and list marks the patch as pinned", async () => {
  const w = world();
  const sha = branch(w, "mine", { "mine.txt": "1\n" });
  configure(w, []);
  expect((await run(w, "add", "mine", "Mine", "--pin", sha)).code).toBe(0);
  expect(load(dirOf(w)).patches[0].pin).toBe(sha);
  expect((await run(w, "list")).out).toContain(`pinned ${sha.slice(0, 7)}`);
  const bad = await run(w, "add", "other", "Other", "--pin", "nope");
  expect(bad.code).toBe(1);
  expect(bad.err).toContain("--pin needs a commit");
  expect(read(join(dirOf(w), "patches.json"))).not.toContain("other");
});

test("remove finds the patch however its source is spelled", async () => {
  const w = world();
  configure(w, ["#3"]);
  const removed = await run(w, "remove", "ACME/Widget#3", "--reason", "landed");
  expect(removed.code).toBe(0);
  expect(removed.out).toContain("retired acme/widget#3: landed");
  expect(load(dirOf(w)).patches).toEqual([]);
});
