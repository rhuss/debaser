import { stopIfInterrupted } from "./git";

/** Every ref debaser writes lives under `refs/debaser/` (data-model.md "Refs"). */
export const root = "refs/debaser";
export const refs = {
  pull: (repo: string, n: number) => `${root}/${repo}/pull/${n}`,
  forkHead: (where: string, branch: string) => `${root}/${where}/heads/${branch}`,
  rebaseBackup: (b: string) => `${root}/rebase-backup/${b}`,
  rebased: (b: string) => `${root}/rebased/${b}`,
  rebaseLease: (b: string) => `${root}/rebase-lease/${b}`,
  rebaseChecking: (b: string) => `${root}/rebase-checking/${b}`,
  fork: (b: string) => `${root}/fork/${b}`,
  branch: (b: string) => `refs/heads/${b}`,
  prev: (b: string) => `refs/heads/${b}-prev`,
};

const zero = "0".repeat(40);
/** Applies ref updates all or nothing; `old` null means the ref must not exist, undefined means any value. */
export function updateRefs(cwd: string, updates: { ref: string; value: string; old?: string | null }[]): boolean {
  const lines = [
    "start",
    ...updates.map(u => `update ${u.ref} ${u.value}${u.old === undefined ? "" : ` ${u.old ?? zero}`}`),
    "commit",
    "",
  ];
  const p = Bun.spawnSync(["git", "update-ref", "--stdin"], {
    cwd,
    stdin: new TextEncoder().encode(lines.join("\n")),
    stdout: "pipe",
    stderr: "pipe",
  });
  stopIfInterrupted(p);
  return p.exitCode === 0;
}
