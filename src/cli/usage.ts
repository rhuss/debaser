export const usage = `usage: debaser [--dir <path>] <command> [options]

commands:
  add <source> [description] [--description <text>] [--pin <sha>]
          [--upstream owner/repo] [--after <patch> | --before <patch>]
                        add a patch: 123, #123, owner/repo#12, a PR URL,
                        owner/repo:branch, a tree URL, <git url>#branch=<name>
                        or a local branch name; --after/--before insert it
                        there instead of at the end
  remove <source> --reason <text>
                        retire a patch
  move <patch> --after <patch> | --before <patch>
                        change the merge order; <patch> is a position as in
                        list (3) or a source (#12 is PR 12)
  move                  reorder with numbered prompts on a terminal
  move --propose [--fetch] [--yes]
                        test-merge the patches in memory and propose an order
                        with fewer conflicts; --yes applies it without asking
  list [--verbose] [--retired] [--json]
                        show the patches; --verbose or --retired adds the
                        retired ones
  build [--verbose] [--push] [--rebase all|conflicting|off] [--in-worktree]
          [--trust-recipe] [--json]
                        rebase own branches, merge the patches onto upstream,
                        run the recipe's checks and install the artifact
  rebase [--verbose] [--push] [--rebase all|conflicting] [--in-worktree]
          [--trust-recipe] [--json]
                        only rebase own branches onto upstream
  rebase --skip-branch [--verbose]
                        give up the branch a rebase run stopped at
  continue [--skip-branch] [--trust-recipe] [--verbose]
                        resume a stopped run
  rollback [--verbose]  return to the last successful build
  status [--fetch] [--json]
                        show each patch's state and how far upstream moved
  recipe [--json]       print the effective recipe and the layer of each value
  trust                 trust the recipe committed in the project's repository

options:
  --dir <path>          debaser's directory (default: <git-common-dir>/debaser,
                        or DEBASER_DIR)
  --version, --help

build, continue and rollback work in the build directory (patch list "tree",
default ../<checkout>-debaser), never in the checkout they are started from.

On a terminal, build, rebase and continue show a live view; --verbose pins
it above the full log. rollback shows its steps, and with --verbose the
install's output instead.

exit codes: 0 success, 1 usage or precondition error, 2 merge or rebase
conflict, 3 a step fails only on the patched tree, 4 upstream is broken,
5 the harness ran out of attempts, 6 an acceptance check fails,
129/130/143 ended by SIGHUP/SIGINT/SIGTERM.`;
