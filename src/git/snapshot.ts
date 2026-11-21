import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { git } from "./git";

/** Each changed or untracked path with its status and content, to tell later
 * what someone else changed in the working tree. */
export type Snapshot = Record<string, string>;
export function snapshot(cwd: string): Snapshot {
  const entries = git(cwd, ["status", "--porcelain", "-z", "--untracked-files=all"]).stdout.split("\0"),
    out: Snapshot = {};
  for (let i = 0; i < entries.length; i++) {
    const entry = entries[i];
    if (entry.length < 4) continue;
    const xy = entry.slice(0, 2),
      path = entry.slice(3);
    // A rename's original path follows as its own entry.
    if (xy[0] === "R" || xy[0] === "C") i++;
    out[path] = `${xy}:${contentHash(join(cwd, path))}`;
  }
  return out;
}
function contentHash(path: string): string {
  try {
    return statSync(path).isFile() ? Bun.hash(readFileSync(path)).toString(16) : "other";
  } catch {
    return "missing";
  }
}
/** Paths whose state differs from `before`, leaving out those under `exclude` (repo-relative). */
export function changedSince(cwd: string, before: Snapshot, exclude: string[] = []): string[] {
  const after = snapshot(cwd),
    paths = new Set([...Object.keys(before), ...Object.keys(after)]);
  return [...paths]
    .filter(path => before[path] !== after[path])
    .filter(path => !exclude.some(prefix => prefix && (path === prefix || path.startsWith(prefix + "/"))))
    .sort();
}
