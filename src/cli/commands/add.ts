import type { Context } from "../../core/context";
import { Explained, Usage } from "../../core/errors";
import * as patchlist from "../../core/patchlist";
import * as git from "../../git/git";
import { repositoryOf } from "../../git/remotes";
import { prInfo, stripArea } from "../../github/gh";
import { display, parse, sameSource, urlProblem } from "../../plugins/sources/parse";
import type { Source } from "../../plugins/sources/types";
import type { IO } from "../main";
import type { Outcome } from "../outcome";
import type { Options } from "./index";

const today = (ctx: Context) => ctx.now().toISOString().slice(0, 10);

/** A source named on the command line, checked: no credentials in URLs, a valid branch name. */
export function named(ctx: Context, arg: string | undefined, upstreamRepo: string): { source: Source; shown: string } {
  if (!arg) throw new Usage("name the patch source");
  const source = parse(arg, upstreamRepo);
  const problem = source.kind === "fork-branch" && source.url ? urlProblem(source.url) : null;
  if (problem) throw new Explained(problem);
  if (source.kind === "branch" && !git.validBranchName(ctx.repo, source.name))
    throw new Explained(`${arg} is neither a PR, another repository's branch nor a valid branch name`);
  return { source, shown: display(source) };
}

/** The patch list, created on the first `add` from the `upstream` remote or `--upstream` (FR-001a). */
function bootstrap(ctx: Context, upstreamOption: string | null): patchlist.PatchList {
  if (ctx.list) return ctx.list;
  const remote = "upstream",
    has = git.hasRemote(ctx.repo, remote);
  let repo = upstreamOption;
  if (repo !== null && !/^[\w.-]+\/[\w.-]+$/.test(repo)) throw new Usage("--upstream must be owner/repo");
  if (!repo) {
    if (!has)
      throw new Explained("there is no upstream remote to take the upstream repository from", [
        "  add it: git remote add upstream https://github.com/<owner>/<repo>.git",
        "  or name it: debaser add <source> --upstream <owner>/<repo>",
      ]);
    repo = repositoryOf(git.git(ctx.repo, ["remote", "get-url", remote]).stdout).split("/").slice(-2).join("/");
  }
  return patchlist.create({ repo, remote, branch: has ? defaultBranch(ctx.repo, remote) : "main" });
}
/** The remote's default branch: its recorded HEAD, else what it advertises, else `main`. */
function defaultBranch(repo: string, remote: string): string {
  const known = git.git(repo, ["symbolic-ref", "--quiet", "--short", `refs/remotes/${remote}/HEAD`]);
  if (known.code === 0) return known.stdout.trim().slice(remote.length + 1);
  const advertised = /ref: refs\/heads\/(\S+)\s+HEAD/.exec(git.git(repo, ["ls-remote", "--symref", remote, "HEAD"]).stdout);
  return advertised?.[1] ?? "main";
}

/** Appends a patch; a PR without a description takes its title (FR-003). */
export async function run(ctx: Context, o: Options, _io: IO): Promise<Outcome> {
  const list = bootstrap(ctx, o.upstream),
    { source, shown } = named(ctx, o.positional[0], list.upstream.repo);
  let description = o.description ?? o.positional[1] ?? null;
  if (list.patches.some(p => sameSource(p.source, source))) throw new Explained(`${shown} is already in the list`);
  // debaser resets the integration branch and replaces its backup on every run.
  const owned = [list.branch, `${list.branch}-prev`];
  if (source.kind === "branch" && owned.includes(source.name))
    throw new Explained(`${shown} is a branch debaser resets (${owned.join(", ")}); rename it or set another branch`);
  let pin: string | undefined;
  if (o.pin !== null) {
    const sha = git.revParse(ctx.repo, o.pin);
    if (!sha && !/^[0-9a-f]{40}$/.test(o.pin)) throw new Explained(`--pin needs a commit: ${o.pin} is not one known here (fetch it first)`);
    pin = sha ?? o.pin;
  }
  if (!description && source.kind === "pr") {
    const info = prInfo(source.repo, source.number, ctx.env);
    if (info?.title) description = stripArea(info.title);
  }
  // A branch without a description is named by its branch (data-model.md "Patch").
  if (!description && source.kind !== "pr") description = source.kind === "branch" ? source.name : source.branch;
  description = description?.replace(/\s+/g, " ").trim() ?? "";
  if (!description) throw new Explained(`${shown} needs a description (no PR title to take it from): debaser add ${shown} "<description>"`);
  list.patches.push({ source, description, added: today(ctx), ...(pin ? { pin } : {}) });
  patchlist.save(ctx.dir, list);
  return { code: 0, lines: [`added ${shown}: ${description}${pin ? ` (pinned at ${pin.slice(0, 7)})` : ""}`] };
}
