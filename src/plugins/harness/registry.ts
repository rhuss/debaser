import { claude } from "./claude";
import { codex } from "./codex";
import { opencode } from "./opencode";
import { pi } from "./pi";
import { plain } from "./plain";
import type { HarnessAdapter } from "./types";

const adapters = new Map<string, HarnessAdapter>([claude, codex, pi, opencode, plain].map(a => [a.kind, a]));
export function get(name: string): HarnessAdapter | undefined {
  return adapters.get(name);
}
export function names(): string[] {
  return [...adapters.keys()];
}
