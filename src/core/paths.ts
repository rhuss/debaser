import { isAbsolute, join, resolve } from "node:path";
import { git } from "../git/git";

/** debaser's data directory: `--dir` > `DEBASER_DIR` > `<git-common-dir>/debaser`,
 * relative paths taken from `cwd`. */
export function resolveDir(o: {
  dir?: string | null;
  env: Record<string, string | undefined>;
  cwd: string;
  commonDir?: string;
}): string {
  if (o.dir) return resolve(o.cwd, o.dir);
  if (o.env.DEBASER_DIR) return resolve(o.cwd, o.env.DEBASER_DIR);
  const common = o.commonDir ?? commonDirOf(o.cwd);
  return join(common, "debaser");
}

/** The checkout's shared git directory, absolute. */
export function commonDirOf(cwd: string): string {
  const out = git(cwd, ["rev-parse", "--git-common-dir"]);
  if (out.code !== 0) throw Error("not inside a git repository");
  const dir = out.stdout.trim();
  return isAbsolute(dir) ? dir : resolve(cwd, dir);
}

/** Every path in data-model.md's directory layout. */
export const paths = {
  patchList: (dir: string) => join(dir, "patches.json"),
  localRecipe: (dir: string) => join(dir, "recipe.toml"),
  trust: (dir: string) => join(dir, "trust.json"),
  run: (dir: string) => join(dir, "run.json"),
  lock: (dir: string) => join(dir, "lock"),
  timings: (dir: string) => join(dir, "timings.json"),
  manifest: (dir: string) => join(dir, "manifest.json"),
  work: (dir: string) => join(dir, "work"),
  reports: (dir: string) => join(dir, "reports"),
  latest: (dir: string) => join(dir, "reports", "latest"),
  startArtifact: (dir: string) => join(dir, "work", "artifact.start"),
};
