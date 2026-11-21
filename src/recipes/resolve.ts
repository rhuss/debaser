import { existsSync, readFileSync } from "node:fs";
import { isAbsolute, join, resolve } from "node:path";
import { Explained } from "../core/errors";
import type { PatchList } from "../core/patchlist";
import { paths } from "../core/paths";
import * as builtin from "./builtin";
import { parseToml, validateRecipe } from "./schema";
import type { EffectiveRecipe, PromptName, RecipeFile, Step } from "./types";

/** One present layer: its id (as provenance names it) and its recipe. `base`
 * is where relative prompt paths resolve (project-repo and local layers). */
export type Layer = { id: string; recipe: RecipeFile; base?: string; readFile?: (path: string) => string | null };

export function parseRecipe(text: string, file: string): RecipeFile {
  return validateRecipe(parseToml(text, file), file);
}

/** Merges present layers, lowest first (FR-039, FR-039a). */
export function mergeLayers(layers: Layer[]): EffectiveRecipe {
  const out: EffectiveRecipe = { generic: null, projectName: "", steps: [], leftovers: [], prompts: {}, provenance: {}, layers: layers.map(l => l.id) };
  for (const layer of layers) {
    const r = layer.recipe,
      from = layer.id;
    if (r.project_name !== undefined) {
      out.projectName = r.project_name;
      out.provenance.project_name = from;
    }
    if (r.install) {
      out.install = { ...(out.install ?? { step: "", triggers: [] }), ...r.install };
      for (const k of Object.keys(r.install)) out.provenance[`install.${k}`] = from;
    }
    if (r.artifact) {
      out.artifact = { ...(out.artifact ?? {}), ...r.artifact };
      for (const k of Object.keys(r.artifact)) out.provenance[`artifact.${k}`] = from;
    }
    if (r.leftovers) {
      out.leftovers = [...new Set([...out.leftovers, ...r.leftovers])];
      out.provenance.leftovers = from;
    }
    if (r.after_build) {
      out.afterBuild = r.after_build;
      out.provenance.after_build = from;
    }
    if (r.prompts)
      for (const [name, value] of Object.entries(r.prompts)) {
        out.prompts[name as PromptName] = promptText(value, layer);
        out.provenance[`prompts.${name}`] = from;
      }
    if (r.steps_replace) {
      for (const s of out.steps) delete out.provenance[`steps.${s.name}`];
      out.steps = [];
    }
    for (const step of r.steps ?? []) {
      const { before, after, ...clean } = step,
        at = out.steps.findIndex(s => s.name === step.name);
      if (at >= 0) out.steps[at] = clean;
      else if (before || after) {
        const anchor = out.steps.findIndex(s => s.name === (before ?? after));
        if (anchor < 0)
          throw new Explained(`step ${step.name} is placed ${before ? "before" : "after"} ${before ?? after}, which no lower layer has`);
        out.steps.splice(before ? anchor : anchor + 1, 0, clean);
      } else out.steps.push(clean);
      out.provenance[`steps.${step.name}`] = from;
    }
  }
  if (out.install && !out.install.step) throw new Explained("the recipe's [install] table names no step");
  if (out.install && !out.steps.some(s => s.name === out.install!.step))
    throw new Explained(`the install step ${out.install.step} is not one of the recipe's steps`);
  return out;
}

/** A prompt override: a path relative to the layer's base when it names a file there, else inline text. */
function promptText(value: string, layer: Layer): string {
  if (!value.includes("\n") && /\.md$/.test(value)) {
    if (layer.readFile) {
      const text = layer.readFile(value);
      if (text !== null) return text;
    } else if (layer.base) {
      const path = isAbsolute(value) ? value : resolve(layer.base, value);
      if (existsSync(path)) return readFileSync(path, "utf8");
    }
    throw new Explained(`${layer.id}: prompt file ${value} does not exist`);
  }
  return value;
}

export type ResolveInput = {
  /** A tree holding the project's files, for generic detection (the checkout or the upstream tip's tree). */
  checkout: string;
  patchList: PatchList;
  dir: string;
  /** The project-repo layer, once read and trusted (layer 3). */
  repoLayer?: Layer | null;
  /** Files at the upstream tip, for detection without a checkout of it. */
  exists?: (path: string) => boolean;
};

/** The effective recipe: generic, built-in project, project repository and
 * local layers, each extending the one below (FR-039 to FR-039b). */
export function resolveRecipe(o: ResolveInput): EffectiveRecipe {
  const upper: Layer[] = [],
    project = builtin.project[o.patchList.upstream.repo.toLowerCase()],
    localPath = paths.localRecipe(o.dir);
  if (project) upper.push({ id: `project:${o.patchList.upstream.repo}`, recipe: parseRecipe(project, `${o.patchList.upstream.repo} recipe`) });
  if (o.repoLayer) upper.push(o.repoLayer);
  if (existsSync(localPath))
    upper.push({ id: "local", recipe: parseRecipe(readFileSync(localPath, "utf8"), localPath), base: o.dir });
  // Only the lowest non-generic layer may name the generic recipe it extends.
  for (const layer of upper.slice(1))
    if (layer.recipe.extends !== undefined)
      throw new Explained(`${layer.id}: extends is only allowed in the lowest non-generic layer (${upper[0].id})`);
  const local = upper.find(l => l.id === "local"),
    chosen = o.patchList.recipe ?? local?.recipe.recipe ?? upper[0]?.recipe.extends,
    known = Object.keys(builtin.generic);
  let generic: string | null = null;
  if (chosen !== undefined) {
    if (!builtin.generic[chosen]) throw new Explained(`no generic recipe named ${chosen}; debaser has ${known.join(", ")}`);
    generic = chosen;
  } else {
    const has = o.exists ?? ((path: string) => existsSync(join(o.checkout, path))),
      matching = known.filter(name => (parseRecipe(builtin.generic[name], name).detect ?? []).some(has));
    if (matching.length > 1)
      throw new Explained(`several generic recipes match this project: ${matching.join(", ")}; name one with "recipe" in the patch list`);
    if (matching.length === 1) generic = matching[0];
    else if (!upper.length)
      throw new Explained(`no recipe matches this project; debaser has ${known.join(", ")}`, [
        '  name one with "recipe" in the patch list, or write a local recipe.toml beside it',
      ]);
  }
  const layers: Layer[] = [
    ...(generic ? [{ id: `generic:${generic}`, recipe: parseRecipe(builtin.generic[generic], generic) }] : []),
    ...upper,
  ];
  const merged = mergeLayers(layers);
  merged.generic = generic;
  if (!merged.projectName) merged.projectName = o.patchList.upstream.repo.split("/")[1] ?? o.patchList.upstream.repo;
  if (!merged.steps.length) throw new Explained("the recipe has no steps");
  return merged;
}
