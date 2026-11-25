import { existsSync, mkdirSync, readFileSync } from "node:fs";
import * as harnessRegistry from "../plugins/harness/registry";
import { urlProblem } from "../plugins/sources/fork-branch";
import type { Source } from "../plugins/sources/types";
import { Explained } from "./errors";
import { paths } from "./paths";
import { writeJSON } from "./runstate";

export const rebaseModes = ["all", "conflicting", "off"] as const;
export type RebaseMode = (typeof rebaseModes)[number];
export type AcceptanceCheck = { run: string[]; exit?: number; match?: string; timeout?: number };
export type Patch = { source: Source; description: string; added: string; pin?: string; acceptance?: AcceptanceCheck };
export type RetiredPatch = Patch & { retired: string; reason: string };
export type HarnessCommand = { command: string[]; kind?: string };
export type HarnessConfig = HarnessCommand & {
  timeoutSeconds?: number;
  attempts?: number;
  tasks?: Partial<Record<"conflict" | "check" | "acceptance" | "rebase", HarnessCommand>>;
};
export type PatchList = {
  version: 1;
  upstream: { repo: string; remote: string; branch: string };
  branch: string;
  recipe?: string;
  rebase?: RebaseMode;
  harness?: HarnessConfig;
  /** The build directory: absolute, or relative to the main worktree; kept as written. */
  tree?: string;
  patches: Patch[];
  retired: RetiredPatch[];
};

export const defaultBranch = "debaser";

const strings = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");
const text = (v: unknown): v is string => typeof v === "string" && v.length > 0;

function source(value: unknown, where: string): Source {
  const s = (value ?? {}) as Record<string, unknown>;
  switch (s.kind) {
    case "branch":
      if (text(s.name)) return { kind: "branch", name: s.name };
      break;
    case "pr":
      if (text(s.repo) && Number.isInteger(s.number) && (s.number as number) > 0)
        return { kind: "pr", repo: s.repo, number: s.number as number };
      break;
    case "fork-branch": {
      if (text(s.url) && urlProblem(s.url)) throw new Explained(`${where}: ${urlProblem(s.url)}`);
      if (text(s.repo) && text(s.url)) throw new Explained(`${where}: a fork-branch source has exactly one of repo or url`);
      if (text(s.branch) && (text(s.repo) || text(s.url)))
        return { kind: "fork-branch", ...(text(s.repo) ? { repo: s.repo } : { url: s.url as string }), branch: s.branch };
      break;
    }
  }
  throw new Explained(`${where}: invalid source`);
}

function acceptance(value: unknown, where: string): AcceptanceCheck {
  const a = (value ?? {}) as Record<string, unknown>;
  if (!strings(a.run) || !a.run.length) throw new Explained(`${where}: acceptance.run must be a non-empty array of strings`);
  if (a.exit !== undefined && !Number.isInteger(a.exit)) throw new Explained(`${where}: acceptance.exit must be an integer`);
  if (a.timeout !== undefined && !(typeof a.timeout === "number" && a.timeout > 0))
    throw new Explained(`${where}: acceptance.timeout must be a positive number`);
  if (a.match !== undefined) {
    if (typeof a.match !== "string") throw new Explained(`${where}: acceptance.match must be a string`);
    try {
      new RegExp(a.match);
    } catch (error) {
      throw new Explained(`${where}: acceptance.match is not a valid regular expression: ${(error as Error).message}`);
    }
  }
  return {
    run: a.run,
    ...(a.exit !== undefined ? { exit: a.exit as number } : {}),
    ...(a.match !== undefined ? { match: a.match as string } : {}),
    ...(a.timeout !== undefined ? { timeout: a.timeout as number } : {}),
  };
}

function patch(value: unknown, where: string): Patch {
  const p = (value ?? {}) as Record<string, unknown>;
  if (typeof p.description !== "string" || /[\r\n]/.test(p.description))
    throw new Explained(`${where}: description must be a single line`);
  const s = source(p.source, where);
  if (p.pin !== undefined && !(typeof p.pin === "string" && /^[0-9a-f]{40}$/.test(p.pin)))
    throw new Explained(`${where}: pin must be a full commit SHA`);
  return {
    source: s,
    description: p.description,
    added: String(p.added ?? ""),
    ...(p.pin ? { pin: p.pin as string } : {}),
    ...(p.acceptance !== undefined ? { acceptance: acceptance(p.acceptance, `${where} (${describe(s)})`) } : {}),
  };
}
const describe = (s: Source) =>
  s.kind === "branch" ? s.name : s.kind === "pr" ? `${s.repo}#${s.number}` : `${s.repo ?? s.url}:${s.branch}`;

function harnessCommand(h: Record<string, unknown>, where: string): HarnessCommand {
  if (!strings(h.command) || h.command.length === 0) throw new Explained(`${where}.command must be a non-empty array of strings`);
  const kinds = harnessRegistry.names();
  if (h.kind !== undefined && !kinds.includes(h.kind as string))
    throw new Explained(`${where}.kind must be one of ${kinds.join(", ")}`);
  return { command: h.command, ...(h.kind !== undefined ? { kind: h.kind as string } : {}) };
}

/** Validates a parsed patch list; `path` names the file in errors. */
export function validate(raw: unknown, path: string): PatchList {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) throw new Explained(`${path}: expected an object`);
  const r = raw as Record<string, unknown>;
  if (typeof r.version === "number" && r.version > 1)
    throw new Explained(`${path}: version ${r.version} is newer than this debaser understands (1); upgrade debaser`);
  const up = (r.upstream ?? {}) as Record<string, unknown>;
  if (!text(up.repo) || !/^[\w.-]+\/[\w.-]+$/.test(up.repo)) throw new Explained(`${path}: upstream.repo must be owner/repo`);
  const list: PatchList = {
    version: 1,
    upstream: { repo: up.repo, remote: text(up.remote) ? up.remote : "upstream", branch: text(up.branch) ? up.branch : "main" },
    branch: text(r.branch) ? r.branch : defaultBranch,
    patches: Array.isArray(r.patches) ? r.patches.map((p, i) => patch(p, `${path}: patches[${i}]`)) : [],
    retired: Array.isArray(r.retired)
      ? r.retired.map((p, i) => {
          const x = p as Record<string, unknown>;
          return { ...patch(p, `${path}: retired[${i}]`), retired: String(x.retired ?? ""), reason: String(x.reason ?? "") };
        })
      : [],
  };
  if (list.branch === list.upstream.branch) throw new Explained(`${path}: branch must differ from upstream.branch`);
  if (r.recipe !== undefined) {
    if (!text(r.recipe)) throw new Explained(`${path}: recipe must name a generic recipe`);
    list.recipe = r.recipe;
  }
  if (r.tree !== undefined) {
    if (!text(r.tree)) throw new Explained(`${path}: tree must be a non-empty path to the build directory`);
    list.tree = r.tree;
  }
  if (r.rebase !== undefined) {
    if (!rebaseModes.includes(r.rebase as RebaseMode)) throw new Explained(`${path}: rebase must be one of ${rebaseModes.join(", ")}`);
    list.rebase = r.rebase as RebaseMode;
  }
  if (r.harness !== undefined) {
    const h = (r.harness ?? {}) as Record<string, unknown>;
    const positive = (v: unknown, name: string) => {
      if (v === undefined) return undefined;
      if (typeof v !== "number" || !(v > 0)) throw new Explained(`${path}: harness.${name} must be a positive number`);
      return v;
    };
    const base = harnessCommand(h, `${path}: harness`),
      timeoutSeconds = positive(h.timeoutSeconds, "timeoutSeconds"),
      attempts = positive(h.attempts, "attempts");
    // Stored floored, so a fraction below 1 would become 0 attempts.
    if (attempts !== undefined && Math.floor(attempts) < 1) throw new Explained(`${path}: harness.attempts must be at least 1`);
    list.harness = {
      ...base,
      ...(timeoutSeconds !== undefined ? { timeoutSeconds } : {}),
      ...(attempts !== undefined ? { attempts: Math.floor(attempts) } : {}),
    };
    if (h.tasks !== undefined) {
      const tasks = (h.tasks ?? {}) as Record<string, unknown>;
      list.harness.tasks = {};
      for (const [name, value] of Object.entries(tasks)) {
        if (!["conflict", "check", "acceptance", "rebase"].includes(name))
          throw new Explained(`${path}: harness.tasks.${name} is not a task (conflict, check, acceptance, rebase)`);
        list.harness.tasks[name as "conflict"] = harnessCommand((value ?? {}) as Record<string, unknown>, `${path}: harness.tasks.${name}`);
      }
    }
  }
  return list;
}

/** The patch list in `dir`, or null when there is none yet. */
export function load(dir: string): PatchList | null {
  const path = paths.patchList(dir);
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Explained(`${path}: ${(error as Error).message}`);
  }
  return validate(raw, path);
}

export function save(dir: string, list: PatchList): void {
  mkdirSync(dir, { recursive: true });
  writeJSON(paths.patchList(dir), list);
}

/** A fresh patch list (FR-001a). */
export function create(upstream: PatchList["upstream"]): PatchList {
  return { version: 1, upstream, branch: defaultBranch, rebase: "all", patches: [], retired: [] };
}
