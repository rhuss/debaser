import { expect, test } from "bun:test";
import { cargoTest } from "./cargo-test";

const log = [
  "$ cargo test",
  "   Compiling rtk v0.9.0 (/r)",
  "running 12 tests",
  "test rewrite::podman_ps ... FAILED",
  "test rewrite::docker_ps ... ok",
  "test hooks::read_config ... FAILED",
  "",
  "failures:",
  "",
  "---- rewrite::podman_ps stdout ----",
  "thread 'rewrite::podman_ps' panicked at src/rewrite.rs:120:9:",
  "assertion `left == right` failed",
  "",
  "---- hooks::read_config stdout ----",
  "thread 'hooks::read_config' panicked at /r/src/hooks/config.rs:44:5:",
  "called `Result::unwrap()` on an `Err` value",
  "",
  "failures:",
  "    rewrite::podman_ps",
  "    hooks::read_config",
  "",
  "test result: FAILED. 10 passed; 2 failed; 0 ignored; 0 measured; 0 filtered out",
].join("\n");

test("cargo test failures name the failing tests and the files they panicked in", () => {
  const parsed = cargoTest.parse(log, "/r");
  expect(parsed.failedTests).toEqual(["rewrite::podman_ps", "hooks::read_config"]);
  expect(parsed.failedFiles).toEqual(["src/rewrite.rs", "src/hooks/config.rs"]);
  expect(parsed.implicatedPaths).toEqual(["src/rewrite.rs", "src/hooks/config.rs"]);
  expect(parsed.summary).toBe("2 tests fail (rewrite::podman_ps, hooks::read_config): 10 passed, 2 failed");
  expect(parsed.narrowedArgs).toBeUndefined();
});

test("compile errors before the tests name their files from the compiler's locations", () => {
  const parsed = cargoTest.parse(
    [
      "error[E0425]: cannot find value `x` in this scope",
      "  --> src/main.rs:10:5",
      "error[E0308]: mismatched types",
      "   --> src/rewrite.rs:7:12",
      "error: could not compile `rtk` (bin \"rtk\") due to 2 previous errors",
    ].join("\n"),
    "/r",
  );
  expect(parsed.failedTests).toEqual([]);
  expect(parsed.implicatedPaths).toEqual(["src/main.rs", "src/rewrite.rs"]);
  expect(parsed.summary).toBe("2 compile errors in src/main.rs, src/rewrite.rs");
  expect(cargoTest.parse("everything is fine", "/r").summary).toBe("");
});
