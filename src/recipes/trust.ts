import { existsSync, mkdirSync, readFileSync } from "node:fs";
import type { Context } from "../core/context";
import { listOf } from "../core/context";
import { Explained } from "../core/errors";
import { paths } from "../core/paths";
import { writeJSON } from "../core/runstate";
import * as git from "../git/git";
import { parseRecipe, type Layer } from "./resolve";
import type { RecipeFile } from "./types";

/** Where a project keeps the recipe it shares with debaser users (layer 3). */
export const repoRecipePath = ".debaser/recipe.toml";
export type TrustStore = { version: 1; trusted: Record<string, { sha256: string; trustedAt: string }> };

export function loadTrust(dir: string): TrustStore {
  const path = paths.trust(dir);
  if (!existsSync(path)) return { version: 1, trusted: {} };
  try {
    const t = JSON.parse(readFileSync(path, "utf8"));
    return t?.version === 1 && t.trusted ? t : { version: 1, trusted: {} };
  } catch {
    return { version: 1, trusted: {} };
  }
}
export function saveTrust(dir: string, store: TrustStore) {
  mkdirSync(dir, { recursive: true });
  writeJSON(paths.trust(dir), store);
}
export const fingerprint = (text: string) => new Bun.CryptoHasher("sha256").update(text).digest("hex");

/** The project-repo recipe at `tip`, read from git, never from a patch or the
 * merged tree (FR-042); null when the project has none. */
export function readRepoRecipe(repo: string, tip: string): { text: string; recipe: RecipeFile; sha256: string; id: string } | null {
  const out = git.git(repo, ["show", `${tip}:${repoRecipePath}`]);
  if (out.code !== 0) return null;
  const id = `repo:${repoRecipePath}@${tip.slice(0, 7)}`,
    recipe = parseRecipe(out.stdout, `${repoRecipePath} at ${tip.slice(0, 7)}`);
  // The prompt files the recipe names are part of what is trusted: a change to
  // one asks again, as a change to the recipe does (FR-042).
  let hashed = out.stdout;
  for (const path of promptFiles(recipe).sort()) {
    const file = git.git(repo, ["show", `${tip}:.debaser/${path.replace(/^\.\//, "")}`]);
    hashed += `\0${path}\0${file.code === 0 ? file.stdout : ""}`;
  }
  return { text: out.stdout, recipe, sha256: fingerprint(hashed), id };
}
/** The prompt override values of a recipe that name files rather than hold text. */
function promptFiles(recipe: RecipeFile): string[] {
  return Object.values(recipe.prompts ?? {}).filter((v): v is string => typeof v === "string" && !v.includes("\n") && /\.md$/.test(v));
}
/** Control and bidi characters made visible, so the trust question shows what really runs. */
const visible = (text: string) =>
  text.replace(/[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/g, c => `\\u${c.charCodeAt(0).toString(16).padStart(4, "0")}`);
/** What a recipe would run or write, for the trust question. */
export function commandsOf(recipe: RecipeFile): string[] {
  return [
    ...(recipe.steps ?? []).map(s => `${s.name}: ${s.run.join(" ")}`),
    ...(recipe.after_build?.length ? [`after_build: ${recipe.after_build.join(" ")}`] : []),
    ...(recipe.artifact?.install ? [`installs the build at: ${recipe.artifact.install}`] : []),
    ...promptFiles(recipe).map(path => `agent prompt from: .debaser/${path}`),
  ].map(visible);
}
export function recordTrust(ctx: Context, sha256: string) {
  const store = loadTrust(ctx.dir);
  store.trusted[listOf(ctx).upstream.repo] = { sha256, trustedAt: ctx.now().toISOString() };
  saveTrust(ctx.dir, store);
}

/** Layer 3 at `tip`: the project's own recipe once trusted (FR-042). An
 * untrusted or changed one is shown and asked about on a terminal, taken with
 * `--trust-recipe`, and refused (exit 1) in a headless run. With `peek`, an
 * untrusted recipe is left out instead of asked about. With `trustFlag: false`
 * (a command without `--trust-recipe`), the refusal offers only `debaser trust`. */
export function repoLayer(ctx: Context, tip: string, o: { peek?: boolean; trustFlag?: boolean } = {}): Layer | null {
  const found = readRepoRecipe(ctx.repo, tip);
  if (!found) return null;
  const known = loadTrust(ctx.dir).trusted[listOf(ctx).upstream.repo];
  const layer: Layer = {
    id: found.id,
    recipe: found.recipe,
    readFile: path => {
      const out = git.git(ctx.repo, ["show", `${tip}:.debaser/${path.replace(/^\.\//, "")}`]);
      return out.code === 0 ? out.stdout : null;
    },
  };
  if (known?.sha256 === found.sha256) return layer;
  if (o.peek) return null;
  const what = known ? "changed since you trusted it" : "not trusted yet";
  if (ctx.trustRecipe) {
    recordTrust(ctx, found.sha256);
    ctx.progress(`trusting ${repoRecipePath} at ${tip.slice(0, 7)} (--trust-recipe)`);
    return layer;
  }
  if (ctx.ask) {
    const shown = commandsOf(found.recipe);
    const answer = ctx.ask(
      [`The project's recipe ${repoRecipePath} at ${tip.slice(0, 7)} is ${what}. It runs:`, ...shown.map(c => `  ${c}`), "Trust it? [y/N] "].join("\n"),
    );
    if (/^y(es)?$/i.test(answer?.trim() ?? "")) {
      recordTrust(ctx, found.sha256);
      return layer;
    }
    throw new Explained(`the project's recipe ${repoRecipePath} was not trusted; nothing was changed`);
  }
  throw new Explained(`the project's recipe ${repoRecipePath} at ${tip.slice(0, 7)} is ${what}`, [
    `  review it, then run \`debaser trust\`${o.trustFlag === false ? "" : ", or pass --trust-recipe"}`,
  ]);
}
