import { Usage } from "../core/errors";

/** `--name value` or `--name=value` from `args`, removing it; null when absent. */
export function option(args: string[], name: string): string | null {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === `--${name}`) {
      const value = args[i + 1];
      if (value === undefined) throw new Usage(`--${name} needs a value`);
      args.splice(i, 2);
      return value;
    }
    if (args[i].startsWith(`--${name}=`)) {
      const value = args[i].slice(name.length + 3);
      args.splice(i, 1);
      return value;
    }
  }
  return null;
}
export function flag(args: string[], name: string): boolean {
  const i = args.indexOf(`--${name}`);
  if (i < 0) return false;
  args.splice(i, 1);
  return true;
}
export function noMore(args: string[]) {
  if (args.length) throw new Usage(`unexpected ${args.join(" ")}`);
}
