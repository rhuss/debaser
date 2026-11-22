import { closeSync, existsSync, mkdirSync, openSync, readFileSync, rmSync, statSync, writeSync } from "node:fs";
import { Explained } from "./errors";
import { paths } from "./paths";

export type LockInfo = { pid: number; command: string; startedAt: string };

/** Whether a process with `pid` is alive (a process we may not signal counts as alive). */
function alive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function readLock(path: string): LockInfo | null {
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LockInfo;
  } catch {
    return null;
  }
}

/** Takes the checkout's run lock for `command` (FR-001b): refuses while a live
 * process holds it, takes over a lock left by a dead one. Returns the release. */
export function acquire(dir: string, command: string, now: Date = new Date()): () => void {
  mkdirSync(dir, { recursive: true });
  const path = paths.lock(dir),
    info: LockInfo = { pid: process.pid, command, startedAt: now.toISOString() };
  for (let tries = 0; tries < 3; tries++) {
    try {
      const fd = openSync(path, "wx");
      writeSync(fd, JSON.stringify(info) + "\n");
      closeSync(fd);
      return () => release(dir, info.pid);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let held = readLock(path);
      // A lock just created may not hold its owner yet: give its writer a moment.
      for (let wait = 0; !held && wait < 20 && existsSync(path); wait++) {
        Bun.sleepSync(25);
        held = readLock(path);
      }
      if (!held && existsSync(path) && Date.now() - statSync(path).mtimeMs < 2000)
        throw new Explained(`another debaser command is starting in this checkout (${path})`, ["  wait for it to finish"], "another debaser command is running");
      if (held && held.pid !== process.pid && alive(held.pid))
        throw new Explained(
          `another debaser command is running in this checkout: ${held.command} (pid ${held.pid}, since ${held.startedAt})`,
          ["  wait for it to finish, or end that process"],
          "another debaser command is running",
        );
      // A dead holder (or our own stale lock): take it over.
      rmSync(path, { force: true });
    }
  }
  throw new Explained(`could not take the run lock at ${path}`);
}

/** Drops the lock when `pid` still holds it. */
export function release(dir: string, pid: number = process.pid): void {
  const path = paths.lock(dir),
    held = readLock(path);
  if (!held || held.pid === pid) rmSync(path, { force: true });
}

export function holder(dir: string): LockInfo | null {
  return readLock(paths.lock(dir));
}

/** The lock's holder when that process is still alive, else null (a stale lock). */
export function liveHolder(dir: string): LockInfo | null {
  const held = holder(dir);
  return held && alive(held.pid) ? held : null;
}
