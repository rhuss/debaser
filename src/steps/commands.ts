/** What a step's placeholders stand for in the tree it runs in. `tests`: the
 * failing test files of a narrowed rerun; absent on a full run. */
export type Vars = { output: string; root: string; tests?: string[] };

export const word = (text: string) => (/^[\w./@+:=,-]+$/.test(text) ? text : `'${text.replaceAll("'", "'\\''")}'`);

/** A command with `{output}`, `{root}` and `{tests}` filled. `{tests}` as a
 * whole argument becomes one argument per file, and nothing on a full run;
 * inside a longer argument it becomes shell words. */
export function expand(run: string[], vars: Vars): string[] {
  const tests = vars.tests ?? [];
  return run.flatMap(arg =>
    arg === "{tests}"
      ? tests
      : [
          arg
            .replaceAll("{output}", vars.output)
            .replaceAll("{root}", vars.root)
            .replaceAll("{tests}", tests.map(word).join(" ")),
        ],
  );
}
