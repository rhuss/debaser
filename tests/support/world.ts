/** The test world (research R9): a GitHub stand-in of bare repositories, an
 * upstream `acme/widget` with one base commit, a fork `me/widget`, and a clone
 * with `upstream` and `origin` remotes; a fake `gh`, stub steps and stub
 * harnesses. Commands run in-process through `main(argv, io)`. */
import { setDefaultTimeout } from "bun:test";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { main } from "../../src/cli/main";
import * as patchlist from "../../src/core/patchlist";
import type { PatchList } from "../../src/core/patchlist";
import * as runstate from "../../src/core/runstate";
import type { HarnessCall, RunState } from "../../src/core/runstate";
import * as gitTool from "../../src/git/git";
import { snapshot } from "../../src/git/snapshot";
import type { LiveEvent } from "../../src/live/events";
import { parse, slug } from "../../src/plugins/sources/parse";

setDefaultTimeout(60_000);
const scratch = mkdtempSync(join(tmpdir(), "debaser-test-"));
// Bun shares this module across test files, so a file-level afterAll would run
// after the first file only: the scratch directory goes when the process ends.
process.on("exit", () => rmSync(scratch, { recursive: true, force: true }));
let counter = 0;
export const fresh = (name: string) => {
  const dir = join(scratch, `${name}-${++counter}`);
  mkdirSync(dir, { recursive: true });
  return dir;
};

export function git(cwd: string, ...args: string[]): string {
  const p = Bun.spawnSync(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  if (p.exitCode !== 0) throw Error(`git ${args.join(" ")}: ${p.stderr.toString()}`);
  return p.stdout.toString().trim();
}
export const identity = (cwd: string) => {
  git(cwd, "config", "user.name", "Test");
  git(cwd, "config", "user.email", "test@example.invalid");
  git(cwd, "config", "commit.gpgsign", "false");
};
export function write(cwd: string, files: Record<string, string>) {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
}
export function commit(cwd: string, files: Record<string, string>, message = "change") {
  write(cwd, files);
  git(cwd, "add", "--", ...Object.keys(files));
  git(cwd, "commit", "-q", "-m", message);
  return git(cwd, "rev-parse", "HEAD");
}
export const read = (path: string) => readFileSync(path, "utf8");

export type World = { root: string; github: string; upstream: string; seed: string; clone: string; env: Record<string, string> };
export const upstreamRepo = "acme/widget";
export function world(): World {
  const root = fresh("world"),
    github = join(root, "github"),
    upstream = join(github, "acme/widget.git"),
    fork = join(github, "me/widget.git"),
    seed = join(root, "seed"),
    clone = join(root, "clone");
  for (const bare of [upstream, fork]) {
    mkdirSync(bare, { recursive: true });
    git(bare, "init", "-q", "--bare", "-b", "main");
  }
  mkdirSync(seed);
  git(seed, "init", "-q", "-b", "main");
  identity(seed);
  commit(seed, { "base.txt": "one\ntwo\nthree\n", "package.json": "{}\n", ".gitignore": "dist/\nout/\n" }, "base");
  git(seed, "remote", "add", "origin", upstream);
  git(seed, "push", "-q", "origin", "main");
  git(root, "clone", "-q", "-o", "upstream", upstream, clone);
  identity(clone);
  git(clone, "remote", "add", "origin", fork);
  git(clone, "push", "-q", "origin", "main");
  return {
    root,
    github,
    upstream,
    seed,
    clone,
    env: { ...process.env, DEBASER_GITHUB: `file://${github}`, DEBASER_DIR: "" } as Record<string, string>,
  };
}
/** A branch in the clone off upstream main with `files` committed. */
export function branch(w: World, name: string, files: Record<string, string>, from = "upstream/main"): string {
  const back = git(w.clone, "rev-parse", "--abbrev-ref", "HEAD");
  git(w.clone, "checkout", "-q", "-b", name, from);
  const sha = commit(w.clone, files, `${name}: change`);
  git(w.clone, "checkout", "-q", back);
  return sha;
}
function bareOf(w: World, repo: string) {
  const bare = join(w.github, `${repo}.git`);
  if (!existsSync(bare)) {
    mkdirSync(bare, { recursive: true });
    git(bare, "init", "-q", "--bare", "-b", "main");
  }
  return bare;
}
/** A commit published as `refs/pull/<n>/head` on `<github>/<repo>.git`. */
export function pullRequest(w: World, repo: string, n: number, files: Record<string, string>): string {
  const bare = bareOf(w, repo);
  git(w.seed, "fetch", "-q", w.upstream, "main");
  git(w.seed, "checkout", "-q", "--detach", "FETCH_HEAD");
  const sha = commit(w.seed, files, `pr ${n}`);
  git(w.seed, "push", "-q", "-f", bare, `HEAD:refs/pull/${n}/head`);
  git(w.seed, "checkout", "-q", "main");
  return sha;
}
/** A branch published on `<github>/<repo>.git`. */
export function forkBranch(w: World, repo: string, name: string, files: Record<string, string>): string {
  const bare = bareOf(w, repo);
  git(w.seed, "checkout", "-q", "--detach", "main");
  const sha = commit(w.seed, files, `${name}: change`);
  git(w.seed, "push", "-q", "-f", bare, `HEAD:refs/heads/${name}`);
  git(w.seed, "checkout", "-q", "main");
  return sha;
}
export function upstreamMoves(w: World, files: Record<string, string>) {
  commit(w.seed, files, "upstream moves on");
  git(w.seed, "push", "-q", "origin", "main");
}
/** An own PR: `name` pushed to the fork and published as upstream's `refs/pull/<n>/head`; no local branch. */
export function ownPullRequest(w: World, n: number, name: string, files: Record<string, string>): string {
  const sha = branch(w, name, files);
  git(w.clone, "push", "-q", "origin", name);
  git(w.clone, "push", "-q", w.upstream, `${name}:refs/pull/${n}/head`);
  git(w.clone, "branch", "-q", "-D", name);
  return sha;
}
export type GhAnswer = { state: string; title: string; mergeCommit?: string; head?: string; body?: string };
/** Puts a `gh` first on PATH that answers `gh pr view <n> --repo <repo>` from `answers`. */
export function stubGh(w: World, answers: Record<string, GhAnswer>) {
  const bin = fresh("gh-bin");
  for (const [key, answer] of Object.entries(answers)) {
    // `head` is `owner/repo:branch`, the PR's head repository and branch.
    const [, owner, name, ref] = /^([^/]+)\/([^:]+):(.+)$/.exec(answer.head ?? "") ?? [];
    writeFileSync(
      join(bin, `${slug(key)}.json`),
      JSON.stringify({
        state: answer.state,
        title: answer.title,
        body: answer.body ?? "",
        url: `https://github.com/${key.replace("#", "/pull/")}`,
        mergeCommit: answer.mergeCommit ? { oid: answer.mergeCommit } : null,
        ...(answer.head ? { headRepositoryOwner: { login: owner }, headRepository: { name }, headRefName: ref } : {}),
      }),
    );
  }
  writeFileSync(
    join(bin, "gh"),
    `#!/bin/sh\n# gh pr view N --repo R --json ...\nkey=$(printf '%s#%s' "$5" "$3" | tr 'A-Z' 'a-z' | sed 's/[^a-z0-9][^a-z0-9]*/-/g')\n[ -f "${bin}/$key.json" ] || exit 1\ncat "${bin}/$key.json"\n`,
  );
  chmodSync(join(bin, "gh"), 0o755);
  w.env.PATH = `${bin}:${w.env.PATH}`;
}
/** A PATH without a working `gh`, so PR state comes from ancestry. */
export function noGh(w: World) {
  const bin = fresh("no-gh");
  writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n");
  chmodSync(join(bin, "gh"), 0o755);
  w.env.PATH = `${bin}:${w.env.PATH}`;
}

export const dirOf = (w: World) => join(w.clone, ".git", "debaser");
export const installPath = (w: World) => join(w.clone, "dist", "widget-custom");
/** Stub steps that need no real project: typecheck fails while a .txt file
 * says BROKEN, build writes the first-parent merges (parents, then subject). */
export type StubStep = { name: string; run: string[]; parser?: string; timeout?: number; before?: string; after?: string };
export const stubSteps: StubStep[] = [
  { name: "install", run: ["true"] },
  { name: "typecheck", run: ["sh", "-c", "! grep -rqs BROKEN --include=*.txt ."] },
  { name: "test", run: ["true"] },
  {
    name: "build",
    run: [
      "sh",
      "-c",
      'base=$(git rev-parse -q --verify upstream/main || git rev-parse -q --verify origin/main) && mkdir -p "$(dirname "$1")" && git log --merges --first-parent --reverse --format=%P%x09%s "$base..HEAD" > "$1"',
      "build",
      "{output}",
    ],
  },
];
/** The stub steps with `name` changed. */
export const withStep = (name: string, step: Partial<StubStep>): StubStep[] =>
  stubSteps.map(s => (s.name === name ? { ...s, ...step } : s));
const toml = (v: unknown): string =>
  Array.isArray(v) ? `[${v.map(toml).join(", ")}]` : typeof v === "string" ? JSON.stringify(v) : String(v);
export type RecipeExtra = {
  steps?: StubStep[];
  afterBuild?: string[];
  artifact?: { output?: string; install?: string } | null;
  install?: { step: string; triggers: string[]; marker?: string } | null;
  prompts?: Record<string, string>;
  raw?: string;
};
/** The local override recipe the tests run with: the stub steps, replacing any inherited ones. */
export function recipeText(r: RecipeExtra = {}): string {
  const steps = r.steps ?? stubSteps,
    artifact = r.artifact === undefined ? { output: "out/build", install: "dist/widget-custom" } : r.artifact,
    install = r.install === undefined ? { step: "install", triggers: ["package.json"], marker: "node_modules" } : r.install;
  return [
    // Top-level keys first: anything after a table header belongs to that table.
    r.raw ?? "",
    "steps_replace = true",
    ...(r.afterBuild ? [`after_build = ${toml(r.afterBuild)}`] : []),
    "",
    ...(install ? ["[install]", ...Object.entries(install).map(([k, v]) => `${k} = ${toml(v)}`), ""] : []),
    ...(artifact ? ["[artifact]", ...Object.entries(artifact).map(([k, v]) => `${k} = ${toml(v)}`), ""] : []),
    ...(r.prompts ? ["[prompts]", ...Object.entries(r.prompts).map(([k, v]) => `${k} = ${toml(v)}`), ""] : []),
    ...steps.flatMap(s => ["[[steps]]", ...Object.entries(s).map(([k, v]) => `${k} = ${toml(v)}`), ""]),
  ].join("\n");
}
export type Extra = Partial<Omit<PatchList, "patches">> & { recipe?: string } & RecipeExtra & {
    patchExtra?: Record<string, Partial<patchlist.Patch>>;
  };
/** Writes `patches.json` with `patches` (in order) and the local recipe. */
export function configure(w: World, patches: string[], extra: Extra = {}) {
  const { steps, afterBuild, artifact, install, prompts, raw, patchExtra, ...list } = extra;
  patchlist.save(dirOf(w), {
    ...patchlist.create({ repo: upstreamRepo, remote: "upstream", branch: "main" }),
    patches: patches.map(arg => ({
      source: parse(arg, upstreamRepo),
      description: `about ${arg}`,
      added: "2026-11-04",
      ...(patchExtra?.[arg] ?? {}),
    })),
    // Only the rebase tests rebase own branches; they use `configureOwn`.
    rebase: "off",
    ...list,
  } as PatchList);
  writeFileSync(join(dirOf(w), "recipe.toml"), recipeText({ steps, afterBuild, artifact, install, prompts, raw }));
}
/** `configure` without a `rebase` mode, so the default (`all`) applies. */
export const configureOwn = (w: World, patches: string[], extra: Extra = {}) =>
  configure(w, patches, { rebase: undefined, ...extra });

let clock = Date.parse("2026-11-04T10:00:00Z");
/** Moves the test clock on, as a wait (for an answer) would. */
export const advanceClock = (ms: number) => void (clock += ms);
export type Result = { code: number; out: string; err: string };
export async function run(w: World, ...args: string[]): Promise<Result> {
  return runWith(w, {}, ...args);
}
/** `run` with a terminal that answers each question with `ask`, and `sink` collecting the live events. */
export async function runWith(
  w: World,
  o: {
    ask?: (question: string) => string | null;
    sink?: (event: LiveEvent) => void;
    color?: boolean;
    columns?: number;
    rows?: number;
    live?: "inline";
    cwd?: string;
  },
  ...args: string[]
): Promise<Result> {
  let out = "",
    err = "";
  const ask = o.ask;
  const code = await main(args, {
    cwd: o.cwd ?? w.clone,
    env: w.env,
    out: text => void (out += text),
    err: text => void (err += text),
    now: () => new Date((clock += 1000)),
    ask: ask && o.live ? question => ((out += question), ask(question)) : ask,
    sink: o.sink,
    color: o.color,
    columns: o.columns,
    rows: o.rows,
    live: o.live,
  });
  if (process.env.DEBASER_TEST_DEBUG) process.stderr.write(`[${args.join(" ")} -> ${code}]\n${out}${err}`);
  return { code, out, err };
}
export const state = (w: World): RunState | null => runstate.loadRun(dirOf(w));
export const head = (w: World) => git(w.clone, "rev-parse", "HEAD");
export const subjects = (w: World, range: string) => git(w.clone, "log", "--format=%s", "--first-parent", range).split("\n");
export const latest = (w: World) => join(dirOf(w), "reports", "latest");
export const handoffs = (w: World) => {
  const dir = join(latest(w), "handoffs");
  return existsSync(dir) ? readdirSync(dir).sort() : [];
};
/** The build output the stub build wrote, installed: each merge as the patch it brought in. */
export const stamped = (w: World, path = installPath(w)) =>
  read(path)
    .split("\n")
    .filter(Boolean)
    .map(line => {
      const [parents, subject] = line.split("\t"),
        [, source, description] = /^Merge (\S+): (.*)$/.exec(subject) ?? [];
      return { source, commit: parents.split(" ")[1], description };
    });

export function stubHarness(body: string): { command: string[]; calls: () => number; bin: string } {
  const bin = fresh("harness"),
    path = join(bin, "harness");
  writeFileSync(path, `#!/bin/sh\necho call >> "${bin}/calls"\n${body}\n`);
  chmodSync(path, 0o755);
  return {
    command: [path, "{prompt_file}"],
    calls: () => (existsSync(join(bin, "calls")) ? read(join(bin, "calls")).split("\n").filter(Boolean).length : 0),
    bin,
  };
}
export const takeTheirs = 'for f in $(git diff --name-only --diff-filter=U); do git checkout -q --theirs -- "$f"; done';
export const fixBroken = 'for f in $(grep -rl BROKEN --include=*.txt .); do echo fixed > "$f"; done';
export function conflicting(w: World) {
  branch(w, "left", { "base.txt": "one\nLEFT\nthree\n" });
  branch(w, "right", { "base.txt": "one\nRIGHT\nthree\n" });
}
export const conflictingLine = (word: string) => ({ "base.txt": `one\n${word}\nthree\n` });
export const claudeStream = [
  JSON.stringify({ type: "assistant", message: { content: [{ type: "text", text: "Keeping both import blocks." }] } }),
  JSON.stringify({
    type: "result",
    subtype: "success",
    usage: { input_tokens: 1200, cache_creation_input_tokens: 300, cache_read_input_tokens: 49500, output_tokens: 7400 },
  }),
]
  .map(line => `echo '${line}'`)
  .join("\n");
export const keepArgs = `printf '%s\\n' "$@" > "$(dirname "$0")/argv"`;
export const argv = (h: { bin: string }) => read(join(h.bin, "argv")).split("\n").filter(Boolean);
export function interruptHarness(w: World, call: Partial<HarnessCall> & { kind: HarnessCall["kind"] }) {
  const s = state(w)!;
  runstate.saveRun(dirOf(w), {
    ...s,
    stopped: null,
    harnessCall: { attempt: 1, head: head(w), snapshot: snapshot(w.clone), ...call },
  });
}
export function eventWords(events: LiveEvent[]): string[] {
  return events.map(e => {
    switch (e.t) {
      case "stage":
        return `stage ${e.stage} ${e.state}`;
      case "item":
        return `item ${e.stage} ${e.id} ${e.state}${e.outcome ? ` ${e.outcome}` : ""}`;
      case "harness":
        return `harness ${e.state}${e.state === "end" ? ` ok:${e.ok}` : ""}`;
      case "retry":
        return `retry ${e.why}`;
      case "end":
        return `end ok:${e.ok}`;
      default:
        return e.t;
    }
  });
}
/** Whether `want` appears in `words` in order, other words in between; null when it does. */
export const inOrder = (words: string[], want: string[]) => {
  let i = 0;
  for (const word of words) if (word === want[i]) i++;
  return i === want.length ? null : `missing ${want[i]} after ${want[i - 1] ?? "the start"}`;
};
export const fork = (w: World) => join(w.github, "me/widget.git");
export const tip = (w: World, ref: string) => gitTool.revParse(w.clone, ref);
export const behindUpstream = (w: World, ref: string) => !gitTool.isAncestor(w.clone, "upstream/main", ref);
export const backupOf = (w: World, name: string) => tip(w, `refs/debaser/rebase-backup/${name}`);
export const onFork = (w: World, name: string) => git(w.clone, "ls-remote", fork(w), `refs/heads/${name}`).split("\t")[0];
/** The refs a run must never touch: own branches and every repository on the GitHub stand-in. */
export const refs = (w: World) =>
  [
    git(w.clone, "for-each-ref", "--format=%(refname) %(objectname)", "refs/heads/mine", "refs/heads/other"),
    ...["acme/widget", "other/widget", "me/widget"].map(repo =>
      existsSync(join(w.github, `${repo}.git`)) ? git(w.clone, "ls-remote", join(w.github, `${repo}.git`)) : "",
    ),
  ].join("\n");
