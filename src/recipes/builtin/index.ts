// Recipes ship inside the binary (FR-041): embedded at bundle time, never fetched.
import { recipeFiles } from "./embed" with { type: "macro" };

const files: Record<string, string> = recipeFiles();
/** A built-in recipe's `name`: a generic recipe's own name, or a project's `owner/repo`. */
const nameOf = (text: string) => (Bun.TOML.parse(text) as { name?: string }).name ?? "";

/** Generic recipes by name. */
export const generic: Record<string, string> = {};
/** Project recipes by upstream `owner/repo`, lowercase. */
export const project: Record<string, string> = {};
for (const text of Object.values(files)) {
  const name = nameOf(text);
  if (name.includes("/")) project[name.toLowerCase()] = text;
  else if (name) generic[name] = text;
}
