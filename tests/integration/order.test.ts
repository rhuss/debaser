import { expect, test, setDefaultTimeout } from "bun:test";
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import * as patchlist from "../../src/core/patchlist";
import { display, privateRef } from "../../src/plugins/sources/parse";
import type { PrSource } from "../../src/plugins/sources/types";
import {
  branch,
  commit,
  conflicting,
  conflictingLine,
  configure,
  dirOf,
  git,
  noGh,
  ownPullRequest,
  pullRequest,
  refs,
  run,
  runWith,
  stubHarness,
  upstreamMoves,
  upstreamRepo,
  world,
  type Extra,
  type World,
} from "../support/world";

setDefaultTimeout(120_000);

const load = (dir: string) => patchlist.load(dir)!;
/** The patch list's displays, in merge order. */
const order = (w: World) => load(dirOf(w)).patches.map(p => display(p.source));
/** The patch list file's bytes, to check a refusal wrote nothing. */
const bytes = (w: World) => readFileSync(join(dirOf(w), "patches.json"), "utf8");
/** A world with `n` upstream PRs (#101, #102, ...), each changing its own file, configured in that order. */
function withPrs(n: number, extra: Extra = {}): { w: World; shown: string[] } {
  const w = world(),
    numbers = Array.from({ length: n }, (_, i) => 101 + i);
  for (const number of numbers) pullRequest(w, upstreamRepo, number, { [`pr${number}.txt`]: `${number}\n` });
  configure(
    w,
    numbers.map(number => `#${number}`),
    extra,
  );
  return { w, shown: numbers.map(number => `${upstreamRepo}#${number}`) };
}

test("add --after and --before insert at the place named and print the list with the new patch marked", async () => {
  const { w, shown } = withPrs(3);
  const after = await run(w, "add", "#110", "Ten", "--after", "1");
  expect(after.code).toBe(0);
  expect(after.out).toStartWith("added acme/widget#110: Ten\n");
  expect(after.out).toMatch(/^>2 +acme\/widget#110 +\S+ +Ten$/m);
  expect(after.out).toMatch(/^3 +acme\/widget#102 /m);
  expect(order(w)).toEqual([shown[0], "acme/widget#110", shown[1], shown[2]]);
  // `#101` is the PR, not position 101.
  const before = await run(w, "add", "#111", "Eleven", "--before", "#101");
  expect(before.code).toBe(0);
  expect(before.out).toMatch(/^>1 +acme\/widget#111 /m);
  expect(order(w)).toEqual(["acme/widget#111", shown[0], "acme/widget#110", shown[1], shown[2]]);
  // Without a position option, add appends and prints no list, as before.
  expect((await run(w, "add", "#112", "Twelve")).out).toBe("added acme/widget#112: Twelve\n");
  expect(order(w).at(-1)).toBe("acme/widget#112");
});

test("add refuses a reference that names no live patch and bad option combinations, adding nothing", async () => {
  const { w } = withPrs(3),
    was = bytes(w);
  const outOfRange = await run(w, "add", "#110", "Ten", "--after", "9");
  expect(outOfRange.code).toBe(1);
  expect(outOfRange.err).toContain("position 9 is out of range 1..3");
  const zero = await run(w, "add", "#110", "Ten", "--before", "0");
  expect(zero.code).toBe(1);
  expect(zero.err).toContain("position 0 is out of range 1..3");
  const unknown = await run(w, "add", "#110", "Ten", "--after", "#999");
  expect(unknown.code).toBe(1);
  expect(unknown.err).toContain("acme/widget#999 is not in the list");
  const both = await run(w, "add", "#110", "Ten", "--after", "1", "--before", "2");
  expect(both.code).toBe(1);
  expect(both.err).toContain("--after and --before");
  const valueless = await run(w, "add", "#110", "Ten", "--after");
  expect(valueless.code).toBe(1);
  expect(valueless.err).toContain("--after needs a value");
  expect(bytes(w)).toBe(was);
  // On a new list, no position exists yet: nothing is created.
  const v = world();
  const empty = await run(v, "add", "#110", "Ten", "--after", "1");
  expect(empty.code).toBe(1);
  expect(empty.err).toContain("position 1 is out of range");
  expect(patchlist.load(dirOf(v))).toBeNull();
});

test("move <patch> --after|--before reorders, saves and prints the list with the moved patch marked", async () => {
  const { w, shown } = withPrs(4),
    [a, b, c, d] = shown;
  const moved = await run(w, "move", "4", "--after", "1");
  expect(moved.code).toBe(0);
  expect(moved.out).toMatch(/^>2 +acme\/widget#104 /m);
  expect(order(w)).toEqual([a, d, b, c]);
  // Sources in any spelling remove accepts; `#102` is the PR.
  expect((await run(w, "move", "https://github.com/acme/widget/pull/103", "--before", "#101")).code).toBe(0);
  expect(order(w)).toEqual([c, a, d, b]);
  expect((await run(w, "move", "acme/widget#103", "--after", "4")).out).toMatch(/^>4 +acme\/widget#103 /m);
  expect(order(w)).toEqual([a, d, b, c]);
});

test("a move that keeps the order says so and leaves the patch list untouched", async () => {
  const { w } = withPrs(3),
    path = join(dirOf(w), "patches.json"),
    was = bytes(w),
    mtime = statSync(path).mtimeMs;
  const same = await run(w, "move", "2", "--after", "1");
  expect(same.code).toBe(0);
  expect(same.out).toBe("the order is unchanged\n");
  expect(bytes(w)).toBe(was);
  expect(statSync(path).mtimeMs).toBe(mtime);
});

test("move refuses bad references and option combinations, changing nothing", async () => {
  const { w } = withPrs(3),
    was = bytes(w);
  const refused = async (args: string[], text: string) => {
    const r = await run(w, "move", ...args);
    expect(r.code).toBe(1);
    expect(r.err).toContain(text);
  };
  await refused(["2", "--after", "2"], "relative to itself");
  await refused(["2", "--before", "#102"], "relative to itself");
  await refused(["2"], "--after");
  await refused(["2"], "--before");
  await refused(["2", "--after", "1", "--before", "3"], "--after and --before can't be used together");
  await refused(["--after", "1"], "name the patch to move");
  await refused(["9", "--after", "1"], "position 9 is out of range 1..3");
  await refused(["#999", "--after", "1"], "acme/widget#999 is not in the list");
  await refused(["2", "--after", "1", "--yes"], "--propose");
  await refused(["2", "--after", "1", "--fetch"], "--propose");
  await refused(["--yes"], "--propose");
  await refused(["--propose", "2"], "--propose");
  await refused(["--propose", "--after", "1"], "--propose");
  expect(bytes(w)).toBe(was);
});

test("move with fewer than two patches has nothing to reorder; without a patch list it is refused", async () => {
  const { w } = withPrs(1);
  for (const args of [["1", "--after", "1"], [], ["--propose"]]) {
    const r = await run(w, "move", ...args);
    expect(r.code).toBe(0);
    expect(r.out).toBe("nothing to reorder\n");
  }
  const none = await run(world(), "move", "1", "--after", "2");
  expect(none.code).toBe(1);
  expect(none.err).toContain("there is no patch list yet");
});

test("reordering is refused while a run is stopped, changing nothing; plain add and remove behave as before", async () => {
  const w = world();
  conflicting(w);
  configure(w, ["left", "right"]);
  expect((await run(w, "build")).code).toBe(2);
  const was = bytes(w),
    objects = git(w.clone, "count-objects", "-v");
  for (const args of [["move", "1", "--after", "2"], ["move", "--propose"], ["move"], ["add", "other", "Other", "--after", "1"]]) {
    const r = await runWith(w, { ask: () => "1" }, ...args);
    expect(r.code).toBe(1);
    expect(r.err).toContain("a run is stopped or in progress");
    expect(r.err).toContain("stopped: while merging right");
    expect(r.err).toContain("debaser continue, or debaser rollback");
    expect(bytes(w)).toBe(was);
    // Refused before any merge test: not even an unreachable object was written (US5-3).
    expect(git(w.clone, "count-objects", "-v")).toBe(objects);
  }
  expect((await run(w, "add", "other", "Other")).code).toBe(0);
  expect((await run(w, "remove", "other", "--reason", "not needed")).code).toBe(0);
  expect(order(w)).toEqual(["left", "right"]);
});

test("reordering is refused while another debaser process holds the run lock", async () => {
  const { w } = withPrs(2),
    was = bytes(w);
  // A live process other than this one: `acquire` takes over a lock with its own pid.
  writeFileSync(join(dirOf(w), "lock"), JSON.stringify({ pid: process.ppid, command: "build", startedAt: "x" }));
  for (const args of [["move", "1", "--after", "2"], ["move", "--propose"], ["add", "#110", "Ten", "--before", "1"]]) {
    const r = await run(w, ...args);
    expect(r.code).toBe(1);
    expect(r.err).toContain("another debaser command is running in this checkout: build");
  }
  expect(bytes(w)).toBe(was);
});

test("after a reorder, build notes once that recorded resolutions may not apply, until a build with the new order succeeds", async () => {
  const w = world();
  branch(w, "a", { "a.txt": "a\n" });
  branch(w, "b", { "b.txt": "b\n" });
  configure(w, ["a", "b"]);
  const note = "note: the merge order changed since the last successful build; recorded conflict resolutions may not apply";
  const first = await run(w, "build");
  expect(first.code).toBe(0);
  expect(first.err).not.toContain(note);
  expect((await run(w, "move", "b", "--before", "a")).code).toBe(0);
  const changed = await run(w, "build");
  expect(changed.code).toBe(0);
  expect(changed.err.split(note).length - 1).toBe(1);
  const again = await run(w, "build");
  expect(again.code).toBe(0);
  expect(again.err).not.toContain(note);
});

/** A terminal that gives `answers` in turn, then reaches the end of input; `asked` collects the questions. */
function terminal(answers: string[]) {
  const asked: string[] = [];
  return {
    asked,
    ask: (question: string) => {
      asked.push(question);
      return answers.length ? answers.shift()! : null;
    },
  };
}

test("interactive move asks which patch and where, prints the list after each move and saves once at the end", async () => {
  const { w, shown } = withPrs(4),
    [a, b, c, d] = shown,
    t = terminal(["4", "1", "n"]),
    // Every question is asked while this command holds the run lock (FR-023).
    locked = (question: string) => {
      expect(JSON.parse(readFileSync(join(dirOf(w), "lock"), "utf8")).command).toBe("move");
      return t.ask(question);
    };
  const r = await runWith(w, { ask: locked }, "move");
  expect(r.code).toBe(0);
  expect(t.asked).toEqual(["Move which patch? (1-4, Enter to finish) ", "To which position? (1-4) ", "Move another patch? [y/N] "]);
  // The list first, then again after the move with the moved patch marked.
  expect(r.out).toMatch(/^1 +acme\/widget#101 [\s\S]*^>1 +acme\/widget#104 /m);
  expect(order(w)).toEqual([d, a, b, c]);
  // y or yes in any case continues; anything else ends.
  const again = terminal(["1", "4", "YES", "1", "2", "y", "2", "2", "no"]);
  expect((await runWith(w, { ask: again.ask }, "move")).code).toBe(0);
  expect(order(w)).toEqual([b, a, c, d]);
});

test("interactive move re-asks invalid answers with the range and trims answers", async () => {
  const { w, shown } = withPrs(4),
    [a, b, c, d] = shown,
    t = terminal(["0", "9", "x", " 2 ", "", "5", "3", "n"]);
  const r = await runWith(w, { ask: t.ask }, "move");
  expect(r.code).toBe(0);
  expect(r.out.split("answer a number from 1 to 4").length - 1).toBe(5);
  expect(t.asked.filter(q => q.startsWith("Move which patch?"))).toHaveLength(4);
  expect(t.asked.filter(q => q.startsWith("To which position?"))).toHaveLength(3);
  expect(order(w)).toEqual([a, c, b, d]);
});

test("an empty answer to the patch question ends the session and saves the moves made so far", async () => {
  const { w, shown } = withPrs(3),
    [a, b, c] = shown;
  expect((await runWith(w, { ask: terminal(["3", "1", "y", ""]).ask }, "move")).code).toBe(0);
  expect(order(w)).toEqual([c, a, b]);
  // Ending at once changes nothing.
  const was = bytes(w),
    none = await runWith(w, { ask: terminal([""]).ask }, "move");
  expect(none.code).toBe(0);
  expect(none.out).toEndWith("the order is unchanged\n");
  expect(bytes(w)).toBe(was);
});

test("an interactive session cut short by the end of input leaves the patch list unchanged", async () => {
  const { w } = withPrs(3),
    was = bytes(w);
  for (const answers of [[], ["3", "1"], ["3", "1", "y", "2"]]) {
    const r = await runWith(w, { ask: terminal(answers).ask }, "move");
    expect(r.code).toBe(1);
    expect(r.err).toContain("the patch list is unchanged");
    expect(bytes(w)).toBe(was);
  }
});

test("interactive move needs a terminal", async () => {
  const { w } = withPrs(2),
    r = await run(w, "move");
  expect(r.code).toBe(1);
  expect(r.err).toContain("move <patch> --after|--before <patch>");
  expect(r.err).toContain("move --propose");
});

const seven = ["l1", "l2", "l3", "l4", "l5", "l6", "l7"];
const lines = (changes: Record<number, string>) => seven.map((line, i) => changes[i + 1] ?? line).join("\n") + "\n";
/** Two own branches where `follow-up` (listed first) merges cleanly only after
 * `groundwork`: groundwork was branched from follow-up and repeats a change
 * upstream made since, so merging follow-up first leaves groundwork in conflict. */
function stacked(w: World) {
  upstreamMoves(w, { "stack.txt": lines({}) });
  git(w.clone, "fetch", "-q", "upstream");
  branch(w, "follow-up", { "stack.txt": lines({ 6: "Z" }) });
  branch(w, "groundwork", { "stack.txt": lines({ 4: "Z", 6: "X" }) }, "follow-up");
  upstreamMoves(w, { "stack.txt": lines({ 4: "Z" }) });
  git(w.clone, "fetch", "-q", "upstream");
}
/** What a proposal must leave as it was (SC-005): every ref, the checkout and the recorded resolutions. */
const untouched = (w: World) => [
  git(w.clone, "for-each-ref"),
  git(w.clone, "status", "--porcelain"),
  git(w.clone, "rev-parse", "HEAD"),
  existsSync(join(w.clone, ".git", "rr-cache")) ? readdirSync(join(w.clone, ".git", "rr-cache"), { recursive: true }).sort().join("\n") : "",
  refs(w),
];

test("propose puts a patch after the one it builds on, and applies with --yes", async () => {
  const w = world();
  stacked(w);
  configure(w, ["follow-up", "groundwork"]);
  const r = await run(w, "move", "--propose", "--yes");
  expect(r.code).toBe(0);
  expect(r.out).toContain("merge order proposal (merge conflicts only; checks were not run)");
  expect(r.out).toContain("#1 follow-up after #2 groundwork: follow-up builds on groundwork (merged before it, it conflicts in stack.txt)");
  expect(r.out).toContain("conflicts: current order 1, proposed order 0");
  expect(r.out).toMatch(/^>1 +groundwork /m);
  expect(r.out).toEndWith("\nnext: debaser build\n");
  expect(order(w)).toEqual(["groundwork", "follow-up"]);
});

test("propose moves an own branch after a PR it clashes with either way and leaves everything else as it was", async () => {
  const w = world();
  noGh(w);
  branch(w, "mine", conflictingLine("MINE"));
  pullRequest(w, upstreamRepo, 120, conflictingLine("PR"));
  pullRequest(w, upstreamRepo, 121, { "other.txt": "other\n" });
  const h = stubHarness("exit 1");
  configure(w, ["#121", "mine", "#120"], { harness: { command: h.command } });
  // Nothing fetched yet: refused, naming the patches, with the hint.
  const unfetched = await run(w, "move", "--propose");
  expect(unfetched.code).toBe(1);
  expect(unfetched.err).toContain("no fetched commit for acme/widget#121, acme/widget#120");
  expect(unfetched.err).toContain("debaser move --propose --fetch");
  // --fetch fetches first; off a terminal the proposal is printed, not applied.
  const was = bytes(w),
    fetched = await run(w, "move", "--propose", "--fetch");
  expect(fetched.code).toBe(0);
  expect(fetched.err).toContain("fetching acme/widget#120");
  expect(fetched.out).toContain("run debaser move --propose --yes to apply it");
  expect(bytes(w)).toBe(was);
  // From the last fetch on: nothing but unreachable objects is written (SC-005).
  const before = untouched(w),
    shown = await run(w, "move", "--propose");
  expect(shown.code).toBe(0);
  expect(untouched(w)).toEqual(before);
  expect(shown.out).toContain("#2 mine after #3 acme/widget#120: both change base.txt; mine is your branch");
  expect(shown.out).toContain("conflicts no order avoids (the next build hands them to the harness):");
  expect(shown.out).toContain("mine and acme/widget#120: base.txt");
  expect(shown.out).toMatch(/^ +1 acme\/widget#121 +1 acme\/widget#121$/m);
  expect(shown.out).toMatch(/^ +2 mine +2 acme\/widget#120$/m);
  expect(shown.out).toContain("conflicts: current order 1, proposed order 1");
  // A no on the terminal changes nothing; a yes applies, never building or calling the harness.
  const declined = await runWith(w, { ask: () => "n" }, "move", "--propose");
  expect(declined.code).toBe(0);
  expect(declined.out).toEndWith("the order is unchanged\n");
  expect(bytes(w)).toBe(was);
  const asked: string[] = [],
    applied = await runWith(
      w,
      {
        ask: q => {
          // The run lock is held across "Apply this order?" (FR-023).
          expect(JSON.parse(readFileSync(join(dirOf(w), "lock"), "utf8")).command).toBe("move");
          return (asked.push(q), "y");
        },
      },
      "move",
      "--propose",
    );
  expect(applied.code).toBe(0);
  expect(asked).toEqual(["Apply this order? [y/N] "]);
  expect(order(w)).toEqual(["acme/widget#121", "acme/widget#120", "mine"]);
  expect(h.calls()).toBe(0);
  expect(untouched(w).slice(0, 3)).toEqual(before.slice(0, 3));
  expect(untouched(w)[4]).toBe(before[4]);
});

test("propose keeps two PRs that clash either way in order and says the order is already the best", async () => {
  const w = world();
  noGh(w);
  pullRequest(w, upstreamRepo, 130, conflictingLine("ONE"));
  pullRequest(w, upstreamRepo, 131, conflictingLine("TWO"));
  configure(w, ["#130", "#131"]);
  const was = bytes(w),
    r = await runWith(w, { ask: () => "y" }, "move", "--propose", "--fetch");
  expect(r.code).toBe(0);
  expect(r.out).toContain("acme/widget#130 and acme/widget#131: base.txt");
  expect(r.out).toEndWith("the current order is already the best order found\n");
  expect(bytes(w)).toBe(was);
});

test("a patch that conflicts with upstream alone keeps its place and is reported", async () => {
  const w = world();
  branch(w, "stale", conflictingLine("STALE"));
  branch(w, "a", { "a.txt": "a\n" });
  branch(w, "b", { "b.txt": "b\n" });
  upstreamMoves(w, conflictingLine("UPSTREAM"));
  git(w.clone, "fetch", "-q", "upstream");
  configure(w, ["a", "stale", "b"]);
  const r = await run(w, "move", "--propose");
  expect(r.code).toBe(0);
  expect(r.out).toContain("conflicts with upstream alone (no order avoids them; rebase or fix the patch):");
  expect(r.out).toMatch(/^ +stale: base\.txt$/m);
  expect(r.out).toContain("conflicts: current order 1, proposed order 1");
  expect(r.out).toEndWith("the current order is already the best order found\n");
});

test("propose tests a pinned patch at its pin, and with no patch taking part the order is already the best", async () => {
  const w = world();
  noGh(w);
  const pin = branch(w, "pinned", conflictingLine("PIN"));
  git(w.clone, "checkout", "-q", "pinned");
  commit(w.clone, { "base.txt": "one\ntwo\nthree\n", "later.txt": "later\n" }, "pinned: undo");
  git(w.clone, "checkout", "-q", "main");
  pullRequest(w, upstreamRepo, 140, conflictingLine("PR"));
  configure(w, ["pinned", "#140"], { patchExtra: { pinned: { pin } } });
  const r = await run(w, "move", "--propose", "--fetch");
  expect(r.code).toBe(0);
  // At its tip the branch would merge cleanly; at its pin it clashes with the PR.
  expect(r.out).toContain("pinned and acme/widget#140: base.txt");
  // Contained in upstream: skipped, so no patch takes part and no pair is tested.
  const v = world();
  git(v.clone, "branch", "old-one", "upstream/main");
  git(v.clone, "branch", "old-two", "upstream/main");
  configure(v, ["old-one", "old-two"]);
  const none = await run(v, "move", "--propose");
  expect(none.code).toBe(0);
  expect(none.out).toContain("skipped (in upstream already; they keep their place):");
  expect(none.out).toEndWith("the current order is already the best order found\n");
});

test("propose reads an own branch that exists only on origin", async () => {
  const w = world();
  ownPullRequest(w, 150, "pushed-only", conflictingLine("PUSHED"));
  branch(w, "local", conflictingLine("LOCAL"));
  configure(w, ["pushed-only", "local"]);
  const r = await run(w, "move", "--propose");
  expect(r.code).toBe(0);
  expect(r.out).toContain("pushed-only and local: base.txt");
});

test("propose skips a patch the last build found merged upstream, unless it is pinned", async () => {
  const w = world();
  noGh(w);
  pullRequest(w, upstreamRepo, 160, { "pr160.txt": "160\n" });
  pullRequest(w, upstreamRepo, 161, { "pr161.txt": "161\n" });
  configure(w, ["#160", "#161"]);
  expect((await run(w, "move", "--propose", "--fetch")).code).toBe(0);
  // A squash merge leaves the PR's commit outside upstream: only the report says it is merged.
  const pr: PrSource = { kind: "pr", repo: upstreamRepo, number: 160 },
    stamp = join(dirOf(w), "reports", "20261101-100000");
  mkdirSync(stamp, { recursive: true });
  writeFileSync(
    join(stamp, "result.json"),
    JSON.stringify({ command: "build", outcome: "success", patches: [{ source: pr, display: "acme/widget#160", state: "skipped-merged" }, null, { state: "merged" }] }),
  );
  const skipped = await run(w, "move", "--propose");
  expect(skipped.code).toBe(0);
  expect(skipped.out).toMatch(/skipped \(in upstream already; they keep their place\):\n +acme\/widget#160$/m);
  // A pinned patch merges its own commit: an old merged state doesn't skip it.
  const list = load(dirOf(w));
  list.patches[0].pin = git(w.clone, "rev-parse", privateRef(pr)!);
  patchlist.save(dirOf(w), list);
  const pinned = await run(w, "move", "--propose");
  expect(pinned.code).toBe(0);
  expect(pinned.out).not.toContain("skipped (in upstream already");
});
