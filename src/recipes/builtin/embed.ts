import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

/** Every `.toml` file in this directory by file name. Imported as a macro, it
 * runs when the code is bundled, so the recipes ship inside the binary (FR-041)
 * without the registry naming any project. */
export function recipeFiles(): Record<string, string> {
  const dir = import.meta.dir;
  return Object.fromEntries(
    readdirSync(dir)
      .filter(name => name.endsWith(".toml"))
      .sort()
      .map(name => [name, readFileSync(join(dir, name), "utf8")]),
  );
}
