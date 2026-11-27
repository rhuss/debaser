export const promptNames = ["conflict", "check", "acceptance", "rebase_conflict", "rebase_check", "handoff"] as const;
export type PromptName = (typeof promptNames)[number];

/** `tests`: what `{tests}` stands for on a full run (all tests when absent). */
export type Step = { name: string; run: string[]; parser?: string; timeout?: number; before?: string; after?: string; tests?: string[] };
/** One layer's recipe as written (data-model.md "Recipe"). */
export type RecipeFile = {
  name?: string;
  /** Local override only: names the generic recipe (FR-039b). */
  recipe?: string;
  extends?: string;
  detect?: string[];
  install?: { step?: string; triggers?: string[]; marker?: string };
  artifact?: { output?: string; install?: string };
  steps?: Step[];
  steps_replace?: boolean;
  after_build?: string[];
  prompts?: Partial<Record<PromptName, string>>;
  project_name?: string;
  /** Globs of temporary files the build leaves, never committed with a fix. */
  leftovers?: string[];
};
/** The merged result of every layer, plus the layer each value came from. */
export type EffectiveRecipe = {
  /** The generic recipe at the bottom, e.g. `bun-ts`. */
  generic: string | null;
  projectName: string;
  steps: Step[];
  install?: { step: string; triggers: string[]; marker?: string };
  artifact?: { output?: string; install?: string };
  afterBuild?: string[];
  leftovers: string[];
  /** Prompt overrides, resolved to their text. */
  prompts: Partial<Record<PromptName, string>>;
  /** Value path (`steps.test`, `artifact.output`, ...) to its layer (`generic:bun-ts`, `local`, ...). */
  provenance: Record<string, string>;
  /** The layers present, lowest first. */
  layers: string[];
};
/** The after-build command to run, or null: an empty `after_build` switches an inherited one off. */
export const afterBuildOf = (r?: EffectiveRecipe | null): string[] | null => (r?.afterBuild?.length ? r.afterBuild : null);
