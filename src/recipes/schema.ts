import { Explained } from "../core/errors";
import { promptNames, type RecipeFile, type Step } from "./types";
import { names as parserNames } from "../plugins/parsers/registry";

const stepKeys = ["name", "run", "parser", "timeout", "before", "after", "tests"];
const topKeys = ["name", "recipe", "extends", "detect", "install", "artifact", "steps", "steps_replace", "after_build", "prompts", "project_name", "leftovers"];
const strings = (v: unknown): v is string[] => Array.isArray(v) && v.every(x => typeof x === "string");
const isTable = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Validates a parsed recipe (data-model.md "Recipe"). An unknown key, as a
 * newer debaser would write, is refused naming the file and the key. */
export function validateRecipe(raw: unknown, file: string): RecipeFile {
  const fail = (what: string): never => {
    throw new Explained(`${file}: ${what}`);
  };
  if (!isTable(raw)) return fail("expected a table");
  const unknown = (table: Record<string, unknown>, allowed: string[], prefix: string) => {
    for (const key of Object.keys(table)) if (!allowed.includes(key)) fail(`unknown key ${prefix}${key}`);
  };
  unknown(raw, topKeys, "");
  const out: RecipeFile = {};
  const str = (v: unknown, key: string) => (typeof v === "string" ? v : fail(`${key} must be a string`));
  const list = (v: unknown, key: string) => (strings(v) ? v : fail(`${key} must be an array of strings`));
  const command = (v: unknown, key: string) => (strings(v) && v.length ? v : fail(`${key} must be a non-empty array of strings`));
  if (raw.name !== undefined) out.name = str(raw.name, "name");
  if (raw.recipe !== undefined) out.recipe = str(raw.recipe, "recipe");
  if (raw.extends !== undefined) out.extends = str(raw.extends, "extends");
  if (raw.project_name !== undefined) out.project_name = str(raw.project_name, "project_name");
  if (raw.detect !== undefined) out.detect = list(raw.detect, "detect");
  // An empty list in a higher layer switches an inherited command off.
  if (raw.after_build !== undefined) out.after_build = list(raw.after_build, "after_build");
  if (raw.leftovers !== undefined) out.leftovers = list(raw.leftovers, "leftovers");
  if (raw.steps_replace !== undefined) {
    if (typeof raw.steps_replace !== "boolean") fail("steps_replace must be true or false");
    out.steps_replace = raw.steps_replace as boolean;
  }
  if (raw.install !== undefined) {
    if (!isTable(raw.install)) fail("install must be a table");
    const i = raw.install as Record<string, unknown>;
    unknown(i, ["step", "triggers", "marker"], "install.");
    // Each key merges on its own over the lower layer's (FR-039a).
    out.install = {
      ...(i.step !== undefined ? { step: str(i.step, "install.step") } : {}),
      ...(i.triggers !== undefined ? { triggers: list(i.triggers, "install.triggers") } : {}),
      ...(i.marker !== undefined ? { marker: str(i.marker, "install.marker") } : {}),
    } as NonNullable<RecipeFile["install"]>;
  }
  if (raw.artifact !== undefined) {
    if (!isTable(raw.artifact)) fail("artifact must be a table");
    const a = raw.artifact as Record<string, unknown>;
    unknown(a, ["output", "install"], "artifact.");
    out.artifact = {
      ...(a.output !== undefined ? { output: str(a.output, "artifact.output") } : {}),
      ...(a.install !== undefined ? { install: str(a.install, "artifact.install") } : {}),
    };
  }
  if (raw.prompts !== undefined) {
    if (!isTable(raw.prompts)) fail("prompts must be a table");
    const p = raw.prompts as Record<string, unknown>;
    unknown(p, [...promptNames], "prompts.");
    out.prompts = {};
    for (const [k, v] of Object.entries(p)) out.prompts[k as keyof typeof out.prompts] = str(v, `prompts.${k}`);
  }
  if (raw.steps !== undefined) {
    if (!Array.isArray(raw.steps)) fail("steps must be an array of tables ([[steps]])");
    out.steps = (raw.steps as unknown[]).map((s, i): Step => {
      const where = `steps[${i}]`;
      if (!isTable(s)) return fail(`${where} must be a table`);
      unknown(s, stepKeys, `${where}.`);
      const step: Step = { name: str(s.name, `${where}.name`), run: command(s.run, `${where}.run`) };
      if (s.parser !== undefined) {
        step.parser = str(s.parser, `${where}.parser`);
        // A misspelt parser would silently fall back to the generic log scan.
        if (!parserNames().includes(step.parser)) fail(`${where}.parser names no failure parser (known: ${parserNames().join(", ")})`);
      }
      if (s.timeout !== undefined) {
        if (!(typeof s.timeout === "number" && s.timeout > 0)) fail(`${where}.timeout must be a positive number of seconds`);
        step.timeout = s.timeout as number;
      }
      if (s.before !== undefined) step.before = str(s.before, `${where}.before`);
      if (s.after !== undefined) step.after = str(s.after, `${where}.after`);
      if (s.tests !== undefined) step.tests = command(s.tests, `${where}.tests`);
      return step;
    });
    const seen = new Set<string>();
    for (const s of out.steps) {
      if (seen.has(s.name)) fail(`step ${s.name} appears twice`);
      seen.add(s.name);
    }
  }
  return out;
}

/** Parses TOML recipe text, naming the file on a syntax error. */
export function parseToml(text: string, file: string): unknown {
  try {
    return Bun.TOML.parse(text);
  } catch (error) {
    throw new Explained(`${file}: ${(error as Error).message}`);
  }
}
