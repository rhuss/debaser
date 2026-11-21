import { bunTest } from "./bun-test";
import { cargoTest } from "./cargo-test";
import { generic } from "./generic";
import { tsc } from "./tsc";
import type { FailureParser } from "./types";

const parsers = new Map<string, FailureParser>([bunTest, tsc, cargoTest, generic].map(p => [p.name, p]));
export function get(name: string): FailureParser | undefined {
  return parsers.get(name);
}
export function names(): string[] {
  return [...parsers.keys()];
}
/** The parser for a step: its named one, else the generic log scan. */
export function forStep(name: string | undefined): FailureParser {
  return (name && parsers.get(name)) || generic;
}
