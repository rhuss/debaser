/** SC-004, opt in with DEBASER_PERF=1: `move --propose` for 15 patches on a
 * repository of 10,000 tracked files finishes in under 30 seconds. */
import { expect, test } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { configure, git, noGh, pullRequest, run, upstreamRepo, world } from "../support/world";

test.skipIf(!process.env.DEBASER_PERF)(
  "move --propose for 15 patches on 10,000 tracked files takes under 30 seconds",
  async () => {
    const w = world();
    noGh(w);
    for (let d = 0; d < 100; d++) {
      mkdirSync(join(w.seed, "src", `d${d}`), { recursive: true });
      for (let f = 0; f < 100; f++) writeFileSync(join(w.seed, "src", `d${d}`, `f${f}.txt`), `file ${d}/${f}\none\ntwo\nthree\n`);
    }
    git(w.seed, "add", "-A");
    git(w.seed, "commit", "-q", "-m", "ten thousand files");
    git(w.seed, "push", "-q", "origin", "main");
    git(w.clone, "fetch", "-q", "upstream");
    // Every third patch shares a file with the one before it.
    const numbers = Array.from({ length: 15 }, (_, i) => 201 + i);
    numbers.forEach((n, i) => {
      const file = `src/d${i % 3 === 2 ? i - 1 : i}/f0.txt`;
      pullRequest(w, upstreamRepo, n, { [file]: `file\none\nPR ${n}\nthree\n` });
    });
    configure(
      w,
      numbers.map(n => `#${n}`),
    );
    expect((await run(w, "move", "--propose", "--fetch")).code).toBe(0);
    const started = performance.now(),
      r = await run(w, "move", "--propose"),
      took = performance.now() - started;
    process.stderr.write(`move --propose: ${Math.round(took)} ms for 15 patches on 10,000 files\n`);
    expect(r.code).toBe(0);
    expect(took).toBeLessThan(30_000);
  },
  600_000,
);
