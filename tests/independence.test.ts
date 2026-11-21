/** SC-004, FR-050: debaser's core names no corgi code, names or defaults;
 * corgi specifics live only in its project recipe (and the tests of it). */
import { expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = join(import.meta.dir, ".."),
  allowed = new Set(["src/recipes/builtin/tals-corgi.toml"]);
function files(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? files(path) : [path];
  });
}

test("src mentions corgi, custom-build or custom_build only in the corgi recipe and its tests", () => {
  const offending = files(join(root, "src"))
    .map(path => relative(root, path))
    .filter(path => !allowed.has(path) && !path.endsWith(".test.ts"))
    .filter(path => /corgi|custom-build|custom_build/i.test(readFileSync(join(root, path), "utf8")));
  expect(offending).toEqual([]);
});

test("environment variables use debaser's own prefix", () => {
  const offending = files(join(root, "src"))
    .filter(path => !path.endsWith(".test.ts"))
    .filter(path => /CORGI_|CUSTOM_BUILD_/.test(readFileSync(path, "utf8")))
    .map(path => relative(root, path));
  expect(offending).toEqual([]);
});
