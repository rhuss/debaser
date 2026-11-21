# Contract: recipe format (TOML)

Field reference: data-model.md, "Recipe". Layers and merge rules: spec FR-039 to FR-039b.

## Layers, lowest first

1. Generic (built in): `bun-ts`, `rust-cargo`. Chosen by `recipe` in `patches.json` or the local override, then by `extends` of the lowest non-generic layer, then by `detect`.
2. Project (built in), keyed by upstream `owner/repo`: `tals/corgi`, `rtk-ai/rtk`.
3. Project repository: `.debaser/recipe.toml` at the fetched upstream tip, trusted by fingerprint.
4. Local override: `<dir>/recipe.toml`.

## Merge rules

- Scalars and tables: a higher layer's value wins.
- `[[steps]]`: matched by `name`. A matching name replaces the step in place. A new step goes `before`/`after` the named step, else at the end. `steps_replace = true` drops the inherited list first.
- `extends` is allowed only in the lowest non-generic layer present and must name a generic recipe.

## Example: built-in `rtk-ai/rtk`

```toml
extends = "rust-cargo"
project_name = "rtk"

[artifact]
output = "target/release/rtk"
install = "dist/rtk-custom"

[[steps]]
name = "fmt"
run = ["cargo", "fmt", "--check"]
before = "test"

[[steps]]
name = "clippy"
run = ["cargo", "clippy", "--all-targets", "--", "-D", "warnings"]
before = "test"
```

## Example: built-in `tals/corgi`

```toml
extends = "bun-ts"
project_name = "corgi"
after_build = ["./dist/corgi-custom", "reload"]

[artifact]
output = "dist/corgi-debaser"
install = "dist/corgi-custom"

[[steps]]
name = "typecheck"
run = ["bun", "typecheck.ts"]

[[steps]]
name = "native"
run = ["bun", "build.ts", "--native-only"]
before = "test"

[[steps]]
name = "build"
run = ["bun", "build.ts", "--outfile", "{output}"]
```

## Example: a patch list entry with an acceptance check

```json
{
  "source": {"kind": "pr", "repo": "rtk-ai/rtk", "number": 2569},
  "description": "podman rewrite support",
  "added": "2026-11-21",
  "acceptance": {"run": ["{output}", "rewrite", "podman ps"], "exit": 0, "match": "rtk podman"}
}
```
