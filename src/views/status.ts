/** Renders `status` as one table row per patch: how it merges onto upstream,
 * where its own branch stands, its PR and the last build's results, with
 * conflicting files and hints below. */
import { type Cell, link, paint as termPaint, type Tone, table, title, width as cells } from "../live/term";

/** Where an own branch stands; null for patches that aren't own branches. */
export type Own =
  | { kind: "current"; reason?: string }
  | { kind: "pending"; command: string }
  | { kind: "behind"; conflicts: boolean }
  | { kind: "worktree"; path: string; rebasableThere: boolean }
  | { kind: "diverged" }
  | { kind: "other"; reason: string };
export type Row = {
  patch: string;
  /** null: not fetched yet. */
  clean: boolean | null;
  files: string[];
  own: Own | null;
  /** The patch's page (PR or branch), linked from its name on a terminal. */
  url?: string | null;
  /** The PR's live state, "UNKNOWN" when gh can't say, or null for a patch that is no PR. */
  pr?: string | null;
  pinned?: string | null;
  /** The last build's results for the patch: its checks and its acceptance check. */
  checks?: string | null;
  acceptance?: string | null;
  /** Upstream commits since the patch's base. */
  behind?: number | null;
};
export type View = {
  /** Set while a run is stopped or in progress. */
  run: { where: string; startedAt: string; report: string; next: string } | null;
  /** The command holding the lock right now, when its process is alive. */
  running?: { command: string; pid: number; startedAt: string } | null;
  /** The upstream ref's name and its tip; tip null when not fetched yet. */
  upstream: { name: string; tip: string | null };
  rows: Row[];
  /** Upstream commits since the last build, or null without one. */
  sinceBuild?: number | null;
  /** Why own branches aren't rebased at all, if so. */
  note: string | null;
  home?: string;
};

/** How many conflicting files a row lists before it counts the rest. */
const shownFiles = 3;

/** A worktree under `.claude/worktrees/` by its name, anything else with `~` for home. */
export function shortPath(path: string, home = ""): string {
  const marker = "/.claude/worktrees/",
    at = path.lastIndexOf(marker);
  if (at >= 0 && !path.slice(at + marker.length).includes("/")) return path.slice(at + marker.length);
  if (home && (path === home || path.startsWith(`${home}/`))) return `~${path.slice(home.length)}`;
  return path;
}

/** Source files before translations and generated files, which follow from them. */
function byInterest(files: string[]): string[] {
  const derived = (f: string) => /(^|\/)locales\//.test(f) || /\.generated\./.test(f);
  return [...files.filter(f => !derived(f)), ...files.filter(derived)];
}
export function fileSummary(files: string[]): string {
  const ordered = byInterest(files),
    shown = ordered.slice(0, shownFiles).join(", "),
    rest = ordered.length - shownFiles;
  return rest > 0 ? `${shown}, … +${rest}` : shown;
}

function upstreamCell(r: Row): Cell {
  if (r.clean === null) return { text: "? not fetched", tone: "dim" };
  if (r.clean) return { text: "✓ clean", tone: "green" };
  const n = r.files.length;
  return { text: `✗ ${n} conflict${n === 1 ? "" : "s"}`, tone: "red" };
}
function ownCell(own: Own | null, home: string): Cell {
  if (!own) return { text: "-", tone: "dim" };
  switch (own.kind) {
    case "current":
      return { text: own.reason ? `✓ ${own.reason}` : "✓ up to date", tone: "green" };
    case "pending":
      return { text: "! rebased, push pending", tone: "yellow" };
    case "behind":
      return own.conflicts
        ? { text: "✗ behind, conflicts", tone: "red" }
        : { text: "! behind upstream", tone: "yellow" };
    case "worktree":
      return {
        text: `· in worktree ${shortPath(own.path, home)}${own.rebasableThere ? "" : " (origin is ahead)"}`,
        tone: null,
      };
    case "diverged":
      return { text: "! diverged from origin", tone: "yellow" };
    case "other":
      return { text: `! ${own.reason}`, tone: "yellow" };
  }
}

export function render(v: View, o: { color: boolean }): string[] {
  const paint = (text: string, tone: Tone) => termPaint(text, tone, o.color),
    home = v.home ?? "",
    lines: string[] = [];

  // A live lock holder means the run is still going: no continue or rollback hint.
  const running = v.running ?? null,
    state = running
      ? `running: ${running.command} (pid ${running.pid})${v.run ? ` while ${v.run.where}` : ""}`
      : v.run
        ? `stopped while ${v.run.where}`
        : "no run in progress",
    upstream = v.upstream.tip ? `upstream ${v.upstream.name} @ ${v.upstream.tip.slice(0, 7)}` : null;
  lines.push([title(o.color), paint(state, running ? "cyan" : v.run ? "yellow" : null), ...(upstream ? [upstream] : [])].join(" · "));
  if (running || v.run) lines.push(`  ${paint("started", "dim")}  ${running?.startedAt ?? v.run!.startedAt}`);
  if (v.run) lines.push(`  ${paint("report ", "dim")}  ${shortPath(v.run.report, home)}`);
  if (v.run && !running) lines.push(`  ${paint("next   ", "dim")}  ${v.run.next}`);
  if (!v.upstream.tip) {
    lines.push("", `${v.upstream.name} not fetched yet; build to check patches`);
    return lines;
  }
  if (!v.rows.length) return lines;

  if (v.sinceBuild !== undefined)
    lines.push(v.sinceBuild === null ? "no build yet" : `${v.sinceBuild} upstream commit${v.sinceBuild === 1 ? "" : "s"} since the last build`);
  // One row per patch: how it merges, its own branch, its PR and the last build's results.
  const pinned = v.rows.some(r => r.pinned),
    rows = v.rows.map((r): Cell[] => [
      { text: r.patch, url: r.url },
      upstreamCell(r),
      ownCell(r.own, home),
      { text: r.pr ? r.pr.toLowerCase() : "not a PR", tone: r.pr === "MERGED" ? "green" : r.pr === "CLOSED" ? "red" : r.pr && r.pr !== "UNKNOWN" ? null : "dim" },
      { text: r.behind === null || r.behind === undefined ? "?" : String(r.behind), tone: "dim" },
      { text: r.checks ?? "-", tone: r.checks === "pass" ? "green" : r.checks === "fail" ? "red" : "dim" },
      { text: !r.acceptance || r.acceptance === "none" ? "-" : r.acceptance, tone: r.acceptance === "pass" || r.acceptance === "fixed" ? "green" : r.acceptance === "fail" ? "red" : "dim" },
      ...(pinned ? [{ text: r.pinned ? `pinned ${r.pinned.slice(0, 7)}` : "", tone: "dim" as Tone }] : []),
    ]);
  lines.push(
    "",
    ...table(["PATCH", "UPSTREAM", "OWN BRANCH", "PR", "BEHIND", "CHECKS", "PATCH CHECK", ...(pinned ? [""] : [])], rows, { color: o.color }),
  );

  const conflicting = v.rows.filter(r => r.clean === false && r.files.length);
  if (conflicting.length) {
    const width = Math.max(...conflicting.map(r => cells(r.patch))) + 2;
    lines.push("", paint("Conflicts", "bold"));
    for (const r of conflicting)
      lines.push(`  ${link(r.patch, r.url, o.color)}${" ".repeat(width - cells(r.patch))}${fileSummary(r.files)}`);
  }

  const hints: string[] = [],
    owns = v.rows.map(r => r.own);
  for (const r of v.rows)
    if (r.own?.kind === "pending") hints.push(`${r.patch} was rebased earlier; push it with: ${r.own.command}`);
  if (owns.some(s => s?.kind === "behind")) hints.push("Branches behind upstream: `rebase` updates them.");
  if (owns.some(s => s?.kind === "worktree" && s.rebasableThere))
    hints.push("Branches in a worktree: `rebase --in-worktree` rebases them there.");
  if (v.note) hints.push(`Own branches: ${v.note}`);
  if (hints.length) lines.push("", ...hints.map(h => paint(h, "dim")));
  return lines;
}
