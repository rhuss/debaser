/** Patterns of temporary files build tools leave while they run, beyond the
 * recipe's own `leftovers` globs; set once the recipe is resolved. */
let extra: Bun.Glob[] = [];
export function setLeftovers(globs: string[] = []) {
  extra = globs.map(g => new Bun.Glob(g));
}
/** A temporary file a build leaves behind (an interrupted `bun build` writes
 * `.<hash>.bun-build`, and a recipe names more as `leftovers`); never part of a fix. */
export function buildLeftover(path: string): boolean {
  return /(^|\/)\.[^/]+\.bun-build$/.test(path) || extra.some(g => g.match(path));
}
