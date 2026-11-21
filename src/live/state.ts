/** What the live view shows, built from a run's events by a pure reducer. */
import type { PatchList } from "../core/patchlist";
import type { HarnessUse, RebaseResult, RunState } from "../core/runstate";
import type { HarnessKind, Usage } from "../plugins/harness/types";
import { display } from "../plugins/sources/parse";
import * as timings from "../timings/timings";
import type { LiveEvent, Stage, Upstream } from "./events";

export type StageView = {
  name: Stage;
  state: "pending" | "running" | "done";
  /** Time of its finished stretches; a running stage adds the time since `startedMs`. */
  ms: number;
  startedMs: number | null;
  summary: string | null;
};
export type Try = { attempt: number; ok: boolean; reason: string | null; usage: Usage | null };
export type Why = Extract<LiveEvent, { t: "retry" }>["why"];
export type ItemView = {
  id: string;
  state: "pending" | "running" | "done" | "failed" | "skipped";
  outcome: string | null;
  detail: string | null;
  /** When it started running, for its clock; its time once it ended. */
  startedMs: number | null;
  ms: number | null;
  /** Summed over its harness calls; null while none named any. */
  tokens: Usage | null;
  tries: Try[];
  /** The files its harness calls named, kept after they end. */
  files: string[];
  retries: { why: Why; detail: string }[];
  /** The harness call running for it; `addedMs` is what the call added to the estimate. */
  harness: { attempt: number; limit: number; files: string[]; startedMs: number; addedMs: number } | null;
};
export type Ended = Omit<Extract<LiveEvent, { t: "end" }>, "t">;
export type LiveState = {
  command: Extract<LiveEvent, { t: "begin" }>["command"] | null;
  /** Whether the run rewrites own branches: a rebase kind, even continued. */
  rebaseRun: boolean;
  branch: string;
  upstream: Upstream;
  harnessKind: HarnessKind | null;
  links: Record<string, string>;
  stages: StageView[];
  items: Partial<Record<Stage, ItemView[]>>;
  harness: {
    calls: number;
    running: number;
    input: number;
    output: number;
    /** Finished calls whose tokens are unknown. */
    unknown: number;
    medianMs: number | null;
    /** What the running calls add to the estimate. */
    addedMs: number;
  };
  retries: number;
  retriesBy: Record<Why, number>;
  /** The latest harness activity or output line. */
  activity: string | null;
  /** The last 500 lines of output; `logOpen` while the last one has no newline yet. */
  log: string[];
  logOpen: boolean;
  /** The run's estimate as it last sent it, and with the running harness calls added. */
  base: timings.Estimate;
  estimate: timings.Estimate;
  /** Active time before `sinceMs`, when this invocation started counting. */
  clock: { activeMs: number; sinceMs: number | null };
  ended: Ended | null;
};

const logLines = 500;
const none: timings.Estimate = { totalMs: null, leftMs: null, aheadMs: null, last: null };

export function initial(): LiveState {
  return {
    command: null,
    rebaseRun: false,
    branch: "",
    upstream: { name: "", tip: "", newCommits: 0 },
    harnessKind: null,
    links: {},
    stages: [],
    items: {},
    harness: { calls: 0, running: 0, input: 0, output: 0, unknown: 0, medianMs: null, addedMs: 0 },
    retries: 0,
    retriesBy: { flaky: 0, harness: 0, upstream: 0 },
    activity: null,
    log: [],
    logOpen: false,
    base: none,
    estimate: none,
    clock: { activeMs: 0, sinceMs: null },
    ended: null,
  };
}

export const item = (s: LiveState, stage: Stage, id: string): ItemView | undefined =>
  s.items[stage]?.find(i => i.id === id);

const pending = (id: string): ItemView => ({
  id,
  state: "pending",
  outcome: null,
  detail: null,
  startedMs: null,
  ms: null,
  tokens: null,
  tries: [],
  files: [],
  retries: [],
  harness: null,
});
function stageOf(s: LiveState, name: Stage): StageView {
  let stage = s.stages.find(st => st.name === name);
  if (!stage) s.stages.push((stage = { name, state: "pending", ms: 0, startedMs: null, summary: null }));
  return stage;
}
/** The item, added at the end of its stage when the start didn't announce it. */
function itemOf(s: LiveState, stage: Stage, id: string): ItemView {
  stageOf(s, stage);
  const list = (s.items[stage] ??= []);
  let it = list.find(i => i.id === id);
  if (!it) list.push((it = pending(id)));
  return it;
}
function estimated(s: LiveState): timings.Estimate {
  const { base } = s,
    added = s.harness.addedMs;
  if (base.totalMs === null || !added) return base;
  return { ...base, totalMs: base.totalMs + added, leftMs: (base.leftMs ?? 0) + added };
}
function appendLog(s: LiveState, text: string) {
  if (!text) return;
  const parts = text.split("\n"),
    rest = parts.pop()!,
    touched = parts.length + 1;
  parts.forEach((part, i) => {
    if (i === 0 && s.logOpen && s.log.length) s.log[s.log.length - 1] += part;
    else s.log.push(part);
  });
  if (!parts.length && s.logOpen && s.log.length) s.log[s.log.length - 1] += rest;
  else if (rest) s.log.push(rest);
  s.logOpen = !!rest || (!parts.length && s.logOpen);
  for (let i = s.log.length - 1; i >= Math.max(0, s.log.length - touched); i--)
    if (s.log[i].trim()) {
      s.activity = s.log[i];
      break;
    }
  if (s.log.length > logLines) s.log.splice(0, s.log.length - logLines);
}

/** The state after `e`, at `nowMs`; `s` itself is left as it was. */
export function apply(s: LiveState, e: LiveEvent, nowMs: number): LiveState {
  const next = structuredClone(s);
  switch (e.t) {
    case "begin": {
      const fresh = initial();
      fresh.command = e.command;
      fresh.rebaseRun = e.rebaseRun ?? e.command === "rebase";
      fresh.branch = e.branch;
      fresh.upstream = { ...e.upstream };
      fresh.harnessKind = e.harness;
      fresh.links = { ...e.links };
      for (const name of e.stages) stageOf(fresh, name);
      for (const [stage, ids] of Object.entries(e.items) as [Stage, string[]][])
        for (const id of ids) itemOf(fresh, stage, id);
      fresh.harness.medianMs = e.harnessMedianMs;
      fresh.base = fresh.estimate = e.estimate;
      fresh.clock = { activeMs: e.elapsedMs, sinceMs: nowMs };
      return fresh;
    }
    case "stage": {
      const stage = stageOf(next, e.stage);
      if (e.state === "start") {
        if (stage.state !== "running") stage.startedMs = nowMs;
        stage.state = "running";
      } else {
        stage.ms = e.ms ?? stage.ms + (stage.startedMs === null ? 0 : nowMs - stage.startedMs);
        stage.state = "done";
        stage.startedMs = null;
        if (e.summary !== undefined) stage.summary = e.summary;
      }
      if (e.upstream) next.upstream = { ...e.upstream };
      if (e.links) Object.assign(next.links, e.links);
      return next;
    }
    case "item": {
      const it = itemOf(next, e.stage, e.id);
      if (e.state === "start") {
        it.state = "running";
        it.startedMs = nowMs;
        it.ms = null;
        it.outcome = it.detail = null;
      } else {
        it.state = e.state;
        it.ms = e.ms ?? (it.startedMs === null ? null : nowMs - it.startedMs);
        it.outcome = e.outcome ?? null;
        it.detail = e.detail ?? null;
      }
      return next;
    }
    case "retry": {
      next.retries++;
      next.retriesBy[e.why]++;
      itemOf(next, e.stage, e.id).retries.push({ why: e.why, detail: e.detail });
      return next;
    }
    case "harness": {
      const it = itemOf(next, e.stage, e.id),
        h = next.harness;
      if (e.state === "activity") {
        if (e.text) next.activity = e.text;
        return next;
      }
      for (const file of e.files ?? []) if (!it.files.includes(file)) it.files.push(file);
      if (e.state === "start") {
        // Rebase items are timed with their harness calls inside them, so their
        // estimates already hold the calls.
        const addedMs = next.base.totalMs !== null && e.stage !== "rebase" ? (h.medianMs ?? 0) : 0;
        h.calls++;
        h.running++;
        h.addedMs += addedMs;
        it.harness = { attempt: e.attempt, limit: e.limit, files: e.files ?? [], startedMs: nowMs, addedMs };
      } else {
        h.running = Math.max(0, h.running - 1);
        h.addedMs -= it.harness?.addedMs ?? 0;
        it.harness = null;
        const usage = e.usage ?? null;
        it.tries.push({ attempt: e.attempt, ok: !!e.ok, reason: e.reason ?? null, usage });
        if (usage) {
          it.tokens = { input: (it.tokens?.input ?? 0) + usage.input, output: (it.tokens?.output ?? 0) + usage.output };
          h.input += usage.input;
          h.output += usage.output;
        } else h.unknown++;
      }
      next.estimate = estimated(next);
      return next;
    }
    case "log":
      appendLog(next, e.text);
      return next;
    case "estimate":
      next.base = e.estimate;
      next.estimate = estimated(next);
      return next;
    case "end": {
      const { t: _, ...ended } = e;
      next.ended = ended;
      return next;
    }
  }
}


const sum = (values: number[]) => values.reduce((a, b) => a + b, 0);
/** What the run as known so far, beyond its state, means for its estimate:
 * the branches a rebuild's rebase phase is rebasing and items it will skip,
 * and what the effective recipe adds: whether it has an after-build command,
 * and its install step, which runs only when the dependencies changed. */
export type Planning = { rebasing?: string[]; skipped?: string[]; afterBuild?: boolean; install?: string | null };
/** The patches a rebuild merges: the fetched plan's, or the list's before the fetch. */
const planned = (run: RunState, list: PatchList) =>
  run.plan.length
    ? run.plan.filter(p => !p.skip).map(p => ({ name: p.display, accept: !!p.acceptance }))
    : list.patches.map(p => ({ name: display(p.source), accept: !!p.acceptance }));
/** The timing keys a run will have, done or not, for its estimate. `steps` are
 * the effective recipe's step names, in order. */
export function plannedKeys(
  run: RunState,
  list: PatchList,
  steps: string[],
  history: timings.History,
  o: Planning = {},
): string[] {
  const command = run.kind ?? "rebuild",
    keys = [
      "fetch",
      ...[...(run.rebaseTargets ?? []).map(t => t.branch), ...(o.rebasing ?? [])].map(b => `rebase:${b}`),
    ];
  if (command === "rebuild") {
    const patches = planned(run, list);
    keys.push(...patches.map(p => `merge:${p.name}`));
    // The install step runs only when the dependencies changed: planned when recent runs had it.
    const install = (step: string) => history.runs.some(r => r.command === command && `step:${step}` in r.items);
    keys.push(...steps.filter(step => step !== o.install || install(step)).map(step => `step:${step}`));
    keys.push(...patches.filter(p => p.accept).map(p => `accept:${p.name}`));
    if (o.afterBuild) keys.push("after-build");
  }
  if (run.push) keys.push("push");
  return keys.filter(key => !o.skipped?.includes(key));
}
/** The run's estimate now, with the conflict and fix calls it made: their time
 * is in no item. */
export function liveEstimate(
  run: RunState,
  list: PatchList,
  steps: string[],
  history: timings.History,
  o: Planning = {},
): timings.Estimate {
  const t = run.timing ?? { activeMs: 0, items: {}, harnessMs: [] },
    e = timings.estimate(history, run.kind ?? "rebuild", plannedKeys(run, list, steps, history, o), t.items, t.activeMs);
  if (e.totalMs === null) return e;
  const totalMs =
    e.totalMs +
    sum(
      (run.harnessUsage ?? [])
        .filter(u => u.kind !== "rebase-conflict" && u.kind !== "rebase-check")
        .map(u => Math.round(u.seconds * 1000)),
    );
  return { ...e, totalMs, leftMs: Math.max(0, totalMs - t.activeMs) };
}

/** The stages a run goes through; `afterBuild` when the effective recipe has an
 * after-build command. */
export function stagesOf(run: RunState, afterBuild: boolean, rebasing = run.rebased !== undefined): Stage[] {
  const push: Stage[] = run.push ? ["push"] : [];
  if (run.kind === "rebase") return ["fetch", "rebase", ...push];
  return [
    "fetch",
    ...(rebasing ? (["rebase"] as const) : []),
    "merge",
    "verify",
    "accept",
    ...(afterBuild ? (["after-build"] as const) : []),
    ...push,
  ];
}

const mergeOutcomes = new Set([
  "merged",
  "replayed",
  "agent-resolved",
  "user-resolved",
  "skipped-merged",
  "skipped-contained",
  "already-contained",
]);
const skipped = (outcome: string) =>
  outcome === "skipped-merged" || outcome === "skipped-contained" || outcome === "already-contained";
/** A rebase result as an item's end. */
export function rebaseItem(r: RebaseResult, ms?: number): LiveEvent {
  const base = { t: "item" as const, stage: "rebase" as const, id: r.branch, ...(ms === undefined ? {} : { ms }) };
  switch (r.outcome) {
    case "rebased":
      return { ...base, state: "done", outcome: "rebased" };
    case "current":
      return { ...base, state: "done", outcome: "current", ...(r.reason ? { detail: r.reason } : {}) };
    case "skipped":
      return { ...base, state: "skipped", outcome: "left-alone", ...(r.reason ? { detail: r.reason } : {}) };
    case "failed":
      // Not a failure of the run: the branch keeps its old tip and is merged as it is.
      return { ...base, state: "skipped", outcome: "not-rebased", ...(r.reason ? { detail: r.reason } : {}) };
  }
}
/** The rebase stage's line once done: `2 rebased · 6 left alone · 1 kept as it was`. */
export function rebaseSummary(results: RebaseResult[]): string {
  const count = (outcome: RebaseResult["outcome"]) => results.filter(r => r.outcome === outcome).length,
    parts = [
      [count("rebased"), "rebased"],
      [count("current"), "current"],
      [count("skipped"), "left alone"],
      [count("failed"), "kept as it was"],
    ] as const;
  return (
    parts
      .filter(([n]) => n)
      .map(([n, what]) => `${n} ${n > 1 ? what.replace("it was", "they were") : what}`)
      .join(" · ") || "nothing to rebase"
  );
}
/** A harness call's stage and item. */
export function harnessItem(u: HarnessUse): { stage: Stage; id: string } {
  if (u.kind === "rebase-conflict" || u.kind === "rebase-check")
    return { stage: "rebase", id: u.branch ?? u.patch ?? "" };
  if (u.kind === "check") return { stage: "verify", id: u.step ?? "" };
  if (u.kind === "acceptance") return { stage: "accept", id: u.patch ?? "" };
  return { stage: "merge", id: u.patch ?? "" };
}

/** The events that rebuild a stopped run's view for `continue`: what it did
 * before the stop, with the durations it recorded. `steps` are the effective
 * recipe's step names, in order. */
export function fromRun(
  run: RunState,
  list: PatchList,
  steps: string[],
  o: {
    history?: timings.History;
    command?: Extract<LiveEvent, { t: "begin" }>["command"];
    upstream?: Upstream;
    links?: Record<string, string>;
    /** Whether the effective recipe has an after-build command. */
    afterBuild?: boolean;
    /** The effective recipe's install step, for the estimate. */
    install?: string | null;
    /** Which agent the harness runs, for its name in the view: by default the
     * patch list's harness kind, null without one. */
    harness?: HarnessKind | null;
  } = {},
): LiveEvent[] {
  const history = o.history ?? { version: 1, runs: [] },
    command = run.kind ?? "rebuild",
    items = run.timing?.items ?? {},
    ms = (key: string) => items[key],
    stageMs = (stage: string) =>
      sum(
        Object.entries(items)
          .filter(([key]) => key.startsWith(`${stage}:`))
          .map(([, v]) => v),
      ),
    stages = stagesOf(run, !!o.afterBuild),
    branches = [...new Set([...(run.rebased ?? []), ...(run.rebaseTargets ?? [])].map(r => r.branch))],
    checked = run.plan.filter(p => !p.skip && p.acceptance).map(p => p.display),
    limit = list.harness?.attempts ?? 3,
    events: LiveEvent[] = [
      {
        t: "begin",
        command: o.command ?? "continue",
        rebaseRun: run.kind === "rebase",
        branch: list.branch,
        upstream: o.upstream ?? {
          name: `${list.upstream.remote}/${list.upstream.branch}`,
          tip: run.upstream.tip,
          newCommits: 0,
        },
        stages,
        items: {
          ...(stages.includes("rebase") ? { rebase: branches } : {}),
          ...(command === "rebuild"
            ? { merge: run.plan.map(p => p.display), verify: [...steps], accept: checked }
            : {}),
        },
        estimate: liveEstimate(run, list, steps, history, { afterBuild: o.afterBuild, install: o.install }),
        links: o.links ?? {},
        harness: o.harness !== undefined ? o.harness : ((list.harness?.kind as HarnessKind | undefined) ?? null),
        harnessMedianMs: timings.harnessMedian(history, command),
        elapsedMs: run.timing?.activeMs ?? 0,
      },
      { t: "stage", stage: "fetch", state: "start" },
      { t: "stage", stage: "fetch", state: "done", ms: ms("fetch") ?? 0 },
    ],
    calls = (stage: Stage) =>
      (run.harnessUsage ?? []).flatMap((u): LiveEvent[] => {
        const at = harnessItem(u);
        if (at.stage !== stage) return [];
        const call = { t: "harness" as const, ...at, attempt: u.attempt, limit };
        return [
          { ...call, state: "start" },
          { ...call, state: "end", usage: u.usage, ok: u.ok, ...(u.reason ? { reason: u.reason } : {}) },
          ...(u.ok ? [] : [{ t: "retry" as const, ...at, why: "harness" as const, detail: u.reason ?? "" }]),
        ];
      });
  if (stages.includes("rebase")) {
    events.push({ t: "stage", stage: "rebase", state: "start" });
    for (const r of run.rebased ?? []) {
      events.push(rebaseItem(r, ms(`rebase:${r.branch}`)));
      for (const f of r.flaky ?? [])
        events.push({ t: "retry", stage: "rebase", id: r.branch, why: "flaky", detail: `${f.step}: ${f.log}` });
    }
    events.push(...calls("rebase"));
    const at = run.rebaseTargets?.[run.rebaseCursor ?? 0];
    if (command === "rebase") {
      if (at) events.push({ t: "item", stage: "rebase", id: at.branch, state: "start" });
    } else
      events.push({
        t: "stage",
        stage: "rebase",
        state: "done",
        summary: rebaseSummary(run.rebased ?? []),
        ms: stageMs("rebase"),
      });
  }
  if (command === "rebuild") {
    events.push({ t: "stage", stage: "merge", state: "start" });
    run.plan.slice(0, run.cursor).forEach(p => {
      const outcome = run.events.findLast(e => e.patch === p.display && mergeOutcomes.has(e.kind))?.kind ?? "merged",
        took = ms(`merge:${p.display}`);
      events.push({
        t: "item",
        stage: "merge",
        id: p.display,
        state: skipped(outcome) ? "skipped" : "done",
        outcome,
        ...(took === undefined ? {} : { ms: took }),
      });
    });
    const merging = run.phase === "merge" ? run.plan[run.cursor] : undefined;
    if (merging) events.push({ t: "item", stage: "merge", id: merging.display, state: "start" });
    events.push(...calls("merge"));
    if (run.phase !== "merge") {
      events.push({ t: "stage", stage: "merge", state: "done", ms: stageMs("merge") });
      events.push({ t: "stage", stage: "verify", state: "start" });
      for (const step of steps) {
        const has = (kind: string) => run.events.some(e => e.kind === kind && e.step === step),
          took = ms(`step:${step}`);
        if (run.phase === "verify" && run.step === step)
          events.push({ t: "item", stage: "verify", id: step, state: "start" });
        else if (has("passed"))
          events.push({
            t: "item",
            stage: "verify",
            id: step,
            state: "done",
            outcome: has("flaky")
              ? "flaky"
              : run.fixes.some(f => f.step === step && f.by === "agent" && !f.acceptance)
                ? "fixed"
                : "passed",
            ...(took === undefined ? {} : { ms: took }),
          });
      }
      for (const e of run.events)
        if (e.kind === "flaky" && e.step)
          events.push({ t: "retry", stage: "verify", id: e.step, why: "flaky", detail: e.detail ?? "" });
      events.push(...calls("verify"));
      if (run.phase !== "verify") {
        events.push({ t: "stage", stage: "verify", state: "done", ms: stageMs("step") });
        // The acceptance checks of this pass: a check with a result ended, the others wait.
        events.push({ t: "stage", stage: "accept", state: "start" });
        for (const patch of checked) {
          const result = run.acceptance.find(a => a.patch === patch)?.result,
            took = ms(`accept:${patch}`);
          if (!result) continue;
          events.push({
            t: "item",
            stage: "accept",
            id: patch,
            state: result === "fail" ? "failed" : result === "skipped" ? "skipped" : "done",
            outcome: result,
            ...(took === undefined ? {} : { ms: took }),
          });
        }
        for (const e of run.events)
          if (e.kind === "flaky" && e.patch && checked.includes(e.patch))
            events.push({ t: "retry", stage: "accept", id: e.patch, why: "flaky", detail: "failed once" });
        events.push(...calls("accept"));
        if (run.phase !== "accept") events.push({ t: "stage", stage: "accept", state: "done", ms: stageMs("accept") });
      }
    }
  }
  return events;
}
