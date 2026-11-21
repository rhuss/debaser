import { branch } from "./branch";
import { forkBranch } from "./fork-branch";
import { pr } from "./pr";
import type { Source, SourceKind } from "./types";

/** In parse order: the most specific forms first, a plain branch name last. */
const kinds: SourceKind<any>[] = [pr, forkBranch, branch];
const byName = new Map<string, SourceKind<any>>(kinds.map(k => [k.kind, k]));

export function get<S extends Source>(name: S["kind"]): SourceKind<S> {
  const k = byName.get(name);
  if (!k) throw Error(`unknown source kind ${name}`);
  return k as SourceKind<S>;
}
export function names(): string[] {
  return kinds.map(k => k.kind);
}
/** The kind of a source. */
export const of = <S extends Source>(s: S): SourceKind<S> => get<S>(s.kind);
